import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: { run: { type: 'string' }, frame: { type: 'string' }, out: { type: 'string' },
    serve: { type: 'boolean' }, edit: { type: 'string', default: 'video/terminal/edit.json' } },
});
const edit = values.frame !== undefined || values.serve ? null :
  JSON.parse(await readFile(resolve(root, values.edit), 'utf8'));
const runId = values.run || edit?.runId;
if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(runId || '')) throw new Error('Provide a valid --run ID or edit manifest.');
async function loadCapture(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) throw new Error('Invalid capture ID.');
  const path = join(root, 'video/terminal', id);
  const raw = await readFile(join(path, 'session.cast'), 'utf8');
  const lines = raw.slice(0, raw.lastIndexOf('\n')).split('\n').map(JSON.parse);
  let metadata = null;
  try { metadata = JSON.parse(await readFile(join(path, 'capture.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { header: lines[0], events: lines.slice(1), captureMode: !values.serve,
    inputOrigin: metadata?.inputOrigin, sha256: createHash('sha256').update(raw).digest('hex') };
}
const captures = new Map();
for (const id of new Set([runId, ...(edit?.captures || [])])) captures.set(id, await loadCapture(id));
let capture = captures.get(runId);
const routes = new Map([
  ['/', [join(root, 'tools/terminal-player.html'), 'text/html; charset=utf-8']],
  ['/xterm.js', [join(root, 'node_modules/@xterm/xterm/lib/xterm.js'), 'text/javascript']],
  ['/xterm.css', [join(root, 'node_modules/@xterm/xterm/css/xterm.css'), 'text/css']],
]);
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/capture.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(capture));
    } else if (routes.has(req.url)) {
      const [path, type] = routes.get(req.url);
      res.writeHead(200, { 'content-type': type });
      res.end(await readFile(path));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Recording server failed.');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
if (values.serve) {
  console.log(`Actual CLI recording player: ${url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
} else {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1792, height: 752 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.evaluate(() => window.captureReady);
    await page.evaluate(data => window.loadCapture(data), capture);
    const size = await page.evaluate(() => window.terminalSize());
    await page.setViewportSize({ width: Math.ceil(size.width / 2) * 2, height: Math.ceil(size.height / 2) * 2 });
    if (values.frame !== undefined) {
      const at = Number(values.frame);
      if (!Number.isFinite(at) || at < 0) throw new Error('--frame must be a non-negative number.');
      await page.evaluate(at => window.seek(at), at);
      const target = resolve(root, values.out || `video/work/terminal-${Math.floor(at)}.png`);
      await mkdir(resolve(target, '..'), { recursive: true });
      await page.screenshot({ path: target });
      console.log(await page.evaluate(() => window.screenText()));
      console.log(`Actual terminal frame: ${target}`);
    } else {
      const report = {
        runId, captures: Object.fromEntries([...captures].map(([id, data]) => [id, data.sha256])),
        renderer: '@xterm/xterm 5.5.0', fps: 12, clips: [], snapshots: [],
        note: 'Only original PTY output is rendered. Cuts and playback speed are declared in edit.json.',
      };
      await mkdir(join(root, 'video/recordings'), { recursive: true });
      let currentCapture = runId;
      let lastImage;
      for (const snapshot of edit.snapshots || []) {
        const data = captures.get(snapshot.capture || runId);
        if (!data) throw new Error('Snapshot references an unknown capture.');
        await page.evaluate(data => window.loadCapture(data), data);
        await page.evaluate(at => window.seek(at), snapshot.at);
        await page.screenshot({ path: resolve(root, snapshot.path) });
        report.snapshots.push({ ...snapshot, visibleText: await page.evaluate(() => window.screenText()) });
      }
      await page.evaluate(data => window.loadCapture(data), capture);
      for (const scene of edit.scenes) {
        const target = join(root, 'video/recordings', `${scene.id}.mp4`);
        const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'image2pipe', '-vcodec', 'png', '-framerate', '12', '-i', 'pipe:0',
          '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17',
          '-r', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target],
        { stdio: ['pipe', 'ignore', 'pipe'] });
        let errorOutput = '';
        encoder.stderr.on('data', chunk => { errorOutput += chunk; });
        const exited = once(encoder, 'close');
        let frames = 0;
        for (const segment of scene.segments) {
          const id = segment.capture || runId;
          if (!captures.has(id)) throw new Error(`Unknown source capture: ${id}`);
          if (currentCapture !== id) {
            capture = captures.get(id);
            await page.evaluate(data => window.loadCapture(data), capture);
            currentCapture = id;
            lastImage = null;
          }
          if (!(segment.from >= 0 && segment.to >= segment.from && segment.to <= capture.events.at(-1)[0] && segment.duration > 0)) {
            encoder.stdin.end();
            throw new Error(`Invalid source interval in ${scene.id}`);
          }
          const count = Math.round(segment.duration * 12);
          for (let i = 0; i < count; i++) {
            const at = segment.from + (segment.to - segment.from) * i / Math.max(1, count - 1);
            const changed = await page.evaluate(at => window.seek(at), at);
            if (changed || !lastImage) lastImage = await page.screenshot();
            if (!encoder.stdin.write(lastImage)) await once(encoder.stdin, 'drain');
            frames++;
          }
        }
        encoder.stdin.end();
        const [code] = await exited;
        if (code !== 0) throw new Error(`Terminal encoding failed: ${errorOutput}`);
        report.clips.push({ scene: scene.id, path: `video/recordings/${scene.id}.mp4`, duration: frames / 12,
          sourceIntervals: scene.segments });
        console.log(`Rendered real CLI: ${scene.id} (${frames / 12}s)`);
      }
      if (errors.length) throw new Error(`Terminal rendering errors: ${errors.join('; ')}`);
      await writeFile(join(root, 'evidence/terminal-render.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
