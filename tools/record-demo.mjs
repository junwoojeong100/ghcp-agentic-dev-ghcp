import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'video/narration.json'), 'utf8'));
const out = resolve(root, 'video/recordings');
await mkdir(out, { recursive: true });
const before = process.env.BEFORE_URL || 'http://127.0.0.1:4311';
const after = process.env.AFTER_URL || 'http://127.0.0.1:4312';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const report = { startedAt: new Date().toISOString(), browser: browser.version(), clips: [], note: 'Actual local browser recordings. No simulated Copilot responses or real payments.' };
try {
  const response = await fetch(`${after}/__demo/evidence`);
  if (!response.ok) throw new Error(`Cannot read recorded-workspace evidence: HTTP ${response.status}`);
  const source = await response.json();
  const expected = JSON.parse(await readFile(resolve(root, 'demo/cli-reference/.demo/state.json'), 'utf8'));
  if (source.currentDigest !== expected.verification.sourceDigest) throw new Error('Browser footage must show the same source as the recorded CLI run.');
  report.sourceDigest = source.currentDigest;
  report.sourceRun = source.state.id;
  for (const scene of config.scenes.filter((item) => item.kind === 'browser')) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 980 }, locale: 'ko-KR',
      recordVideo: { dir: out, size: { width: 1440, height: 980 } },
    });
    const page = await context.newPage();
    const video = page.video();
    const started = Date.now();
    const waitUntil = async (second) => {
      const remaining = second * 1000 - (Date.now() - started);
      if (remaining > 0) await page.waitForTimeout(remaining);
    };
    if (scene.page === 'before') {
      await page.goto(before);
      await waitUntil(6);
      await page.locator('#send-twice').hover();
      await waitUntil(9);
      await page.locator('#send-twice').click();
      await expect(page.locator('#order-count')).toHaveText('2건');
      await expect(page.locator('#result-banner')).toHaveAttribute('data-state', 'duplicate');
      await page.locator('#order-count').hover();
    } else if (scene.page === 'after') {
      await page.goto(after);
      await waitUntil(5);
      await page.locator('#send-twice').hover();
      await waitUntil(8);
      await page.locator('#send-twice').click();
      await expect(page.locator('#order-count')).toHaveText('1건');
      await page.locator('#order-count').hover();
      await waitUntil(19);
      await page.locator('#new-order').hover();
      await waitUntil(21);
      await page.locator('#new-order').click();
      await expect(page.locator('#order-count')).toHaveText('2건');
      await expect(page.locator('#request-count')).toHaveText('3회');
    } else throw new Error(`Browser scene is not an actual customer scenario: ${scene.page}`);
    await waitUntil(scene.duration + 2);
    await page.close();
    await context.close();
    const original = await video.path();
    const target = resolve(out, `${scene.id}.webm`);
    await rename(original, target);
    report.clips.push({ scene: scene.id, path: `video/recordings/${scene.id}.webm`, recordedAt: new Date().toISOString(), plannedSeconds: scene.duration });
    console.log(`Recorded ${scene.id}`, { seconds: scene.duration });
  }
} finally {
  report.completedAt = new Date().toISOString();
  report.complete = report.clips.length === config.scenes.filter((scene) => scene.kind === 'browser').length;
  await writeFile(resolve(root, 'evidence/video-recording.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
