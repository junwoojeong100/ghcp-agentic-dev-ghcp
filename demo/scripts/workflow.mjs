import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, lstat, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWED = ['src/app.mjs', 'public/index.html', 'public/app.mjs', 'tests/app.test.mjs'];
const ARTIFACTS = ['01-plan.md', 'plan-approval.json', '02-implementation.md', '02-diff.patch',
  '03-tests.tap', '03-verification.json', '04-review.md', '05-decision.json', '00-baseline.tap',
  '06-browser-check.json'];
const now = () => new Date().toISOString();
const sha = (value) => createHash('sha256').update(value).digest('hex');
const read = (path) => readFile(path, 'utf8');
const json = async (path) => JSON.parse(await read(path));
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const metadata = (dir, file) => join(dir, '.demo', file);

async function exists(path) {
  try { await access(path, constants.F_OK); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function workspace(id, root = ROOT) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id ?? '')) throw new Error('Run ID must use 1-40 lowercase letters, digits, or hyphens.');
  return id === 'reference' ? join(root, 'reference') : join(root, 'runs', id);
}

export async function files(dir, prefix = '') {
  const result = [];
  for (const entry of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['.git', '.demo', 'node_modules', '.DS_Store'].includes(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${relative}`);
    if (entry.isDirectory()) result.push(...await files(dir, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

export async function digest(dir) {
  const hash = createHash('sha256');
  for (const file of await files(dir)) {
    hash.update(file).update('\0').update(await readFile(join(dir, file))).update('\0');
  }
  return hash.digest('hex');
}

async function run(command, args, { cwd = ROOT, env = {}, timeout = 30000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, escalation;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
      escalation.unref();
    }, timeout);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      resolvePromise({ code: code ?? 1, signal, timedOut, stdout, stderr });
    });
  });
}

async function git(dir, ...args) {
  const result = await run('git', ['--no-pager', ...args], { cwd: dir });
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

export async function scope(dir) {
  const tracked = (await git(dir, 'diff', '--name-only', '-z', 'HEAD')).split('\0').filter(Boolean);
  const untracked = (await git(dir, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean);
  const changed = [...new Set([...tracked, ...untracked])].sort();
  return { changed, violations: changed.filter((file) => !ALLOWED.includes(file)) };
}

async function requireScope(dir) {
  const report = await scope(dir);
  if (report.violations.length) throw new Error(`Out-of-scope changes: ${report.violations.join(', ')}`);
  return report;
}

async function stateOf(dir) {
  return json(metadata(dir, 'state.json'));
}

async function updateState(dir, values) {
  const state = { ...await stateOf(dir), ...values, updatedAt: now() };
  await save(metadata(dir, 'state.json'), state);
  return state;
}

export async function prepare(id, root = ROOT) {
  if (id === 'reference') throw new Error('The reference is immutable; choose a fresh run ID.');
  const dir = workspace(id, root);
  if (await exists(dir)) throw new Error(`Run already exists: ${id}. Use a new ID; nothing was overwritten.`);
  await mkdir(dirname(dir), { recursive: true });
  await cp(join(root, 'starter'), dir, { recursive: true, errorOnExist: true, force: false });
  await mkdir(metadata(dir, 'logs'), { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'add', '.');
  await git(dir, '-c', 'user.name=Demo Preparation', '-c', 'user.email=demo@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m',
    'Baseline for the scoped duplicate-order demonstration\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\nCopilot-Session: 36586135-b461-43ae-9c23-08197feeada7');
  const state = {
    schema: 1, id, createdAt: now(), updatedAt: now(), mode: 'live',
    baselineCommit: (await git(dir, 'rev-parse', 'HEAD')).trim(),
    baselineDigest: await digest(dir), allowedFiles: ALLOWED,
    plan: null, planApproval: null, implementation: null, verification: null,
    review: null, decision: null, lastError: null,
  };
  await save(metadata(dir, 'state.json'), state);
  return dir;
}

export function extractFinal(output) {
  const messages = [];
  for (const line of output.split('\n').filter((value) => value.trim())) {
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error('Copilot output was not valid JSONL; inspect the recorded events.'); }
    if (event.type === 'assistant.message' && typeof event.data?.content === 'string') {
      if (event.data.content.trim()) messages.push(event.data.content);
    } else if (event.type === 'result') {
      const text = typeof event.result === 'string' ? event.result :
        typeof event.content === 'string' ? event.content : null;
      if (text?.trim()) messages.push(text);
    }
  }
  if (!messages.length) throw new Error('No final Copilot response found; inspect the recorded events.');
  return `${messages.at(-1).trim()}\n`;
}

async function invokeAgent(dir, role, prompt) {
  const startedAt = now();
  const args = [
    '--agent', `demo-${role}`, '--prompt', prompt, '--output-format', 'json',
    '--stream', 'off', '--no-color', '--no-ask-user', '--no-remote-export',
    '--disallow-temp-dir', '--disable-builtin-mcps', '--deny-tool=shell', '--deny-tool=url',
  ];
  for (const server of ['azure', 'playwright', 'playwright-headless', 'computer-use', 'microsoft-learn', 'enghub']) {
    args.push('--disable-mcp-server', server);
  }
  if (role === 'implementer') {
    for (const file of ALLOWED) args.push(`--allow-tool=write(${join(dir, file)})`);
  } else {
    args.push('--deny-tool=write');
  }
  const version = await run('copilot', ['--version'], { cwd: dir });
  if (version.code !== 0) throw new Error('Copilot CLI is unavailable; use the documented reference fallback.');
  const redact = (value) => value.replaceAll(dir, '<workspace>').replaceAll(ROOT, '<demo-kit>');
  await save(metadata(dir, `logs/${role}.invocation.json`), {
    startedAt, agent: `demo-${role}`, command: 'copilot', args: args.map(redact),
    version: version.stdout.trim(), note: 'Workspace paths are replaced; no output is synthesized.',
  });
  console.log(`Running demo-${role}; a real Copilot request is being made. Logs: .demo/logs/`);
  const result = await run('copilot', args, { cwd: dir, timeout: 240000 });
  await writeFile(metadata(dir, `logs/${role}.events.jsonl`), redact(result.stdout));
  await writeFile(metadata(dir, `logs/${role}.stderr.txt`), redact(result.stderr));
  await save(metadata(dir, `logs/${role}.result.json`), {
    startedAt, completedAt: now(), code: result.code, timedOut: result.timedOut, signal: result.signal,
  });
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`Copilot ${role} failed${result.timedOut ? ' (240 s timeout)' : ` (exit ${result.code})`}. See .demo/logs/${role}.stderr.txt; no fallback was substituted.`);
  }
  return { text: extractFinal(result.stdout), startedAt, completedAt: now(), cliVersion: version.stdout.trim() };
}

export async function plan(dir) {
  const state = await stateOf(dir);
  if ((await digest(dir)) !== state.baselineDigest) throw new Error('Plan from a clean baseline; prepare a fresh run.');
  await updateState(dir, { plan: null, planApproval: null, implementation: null, verification: null, review: null, decision: null });
  const result = await invokeAgent(dir, 'planner',
    'REQUEST.md의 ORDER-001을 계획하세요. 관련 소스와 테스트를 실제로 읽고, 승인 전에는 구현하지 마세요. 고객 문제와 완료 기준을 먼저 설명하세요. 파일을 쓰지 말고 최종 답변으로 계획만 반환하세요.');
  if ((await digest(dir)) !== state.baselineDigest) throw new Error('Read-only planner changed the source. Stop and investigate.');
  await writeFile(metadata(dir, '01-plan.md'), result.text);
  await updateState(dir, { plan: { hash: sha(result.text), completedAt: result.completedAt, cliVersion: result.cliVersion }, lastError: null });
}

export async function approvePlan(dir, { by, note, rehearsal = false }) {
  const state = await stateOf(dir);
  if (!by?.trim() || !note?.trim()) throw new Error('Approval requires --by and --note. Do not impersonate a human approver.');
  if (!state.plan) throw new Error('No completed plan exists.');
  const planHash = sha(await read(metadata(dir, '01-plan.md')));
  if (planHash !== state.plan.hash) throw new Error('Plan changed after generation. Re-plan before approval.');
  if (await digest(dir) !== state.baselineDigest) throw new Error('Source changed before scope approval. Start a fresh run.');
  const approval = {
    kind: rehearsal ? 'rehearsal-scope-approval' : 'presenter-scope-approval',
    by, note, recordedAt: now(), planHash, requestHash: sha(await read(join(dir, 'REQUEST.md'))),
    baselineCommit: state.baselineCommit, allowedFiles: ALLOWED,
    disclaimer: 'Local demonstration record only; not an authenticated organizational approval.',
  };
  await save(metadata(dir, 'plan-approval.json'), approval);
  await updateState(dir, { planApproval: approval, mode: rehearsal ? 'rehearsal' : 'live', lastError: null });
  return approval;
}

export async function requireApprovedPlan(dir) {
  const state = await stateOf(dir);
  const approval = state.planApproval;
  if (!approval) throw new Error('STOP: scope approval is missing. A person must review the plan first.');
  if (approval.planHash !== sha(await read(metadata(dir, '01-plan.md')))) throw new Error('STOP: approved plan changed.');
  if (approval.requestHash !== sha(await read(join(dir, 'REQUEST.md')))) throw new Error('STOP: approved request changed.');
  if (approval.baselineCommit !== (await git(dir, 'rev-parse', 'HEAD')).trim()) throw new Error('STOP: baseline commit changed.');
  await requireScope(dir);
  return state;
}

export async function implement(dir) {
  await requireApprovedPlan(dir);
  const previous = await stateOf(dir);
  if (previous.implementation) {
    const history = metadata(dir, 'history');
    await mkdir(history, { recursive: true });
    const iteration = (await readdir(history)).length + 1;
    const target = join(history, `iteration-${String(iteration).padStart(2, '0')}`);
    await mkdir(target);
    for (const file of ['state.json', ...ARTIFACTS]) {
      if (await exists(metadata(dir, file))) await cp(metadata(dir, file), join(target, file));
    }
    await cp(metadata(dir, 'logs'), join(target, 'logs'), { recursive: true });
  }
  await updateState(dir, { implementation: null, verification: null, review: null, decision: null });
  const result = await invokeAgent(dir, 'implementer',
    'REQUEST.md, .demo/01-plan.md, .demo/plan-approval.json을 읽고 승인된 변경을 구현하세요. 정확히 허용된 4개 파일만 수정하세요. 테스트 실행은 컨트롤러가 수행하므로 실행하지 마세요. 이전 .demo/04-review.md, .demo/06-browser-check.json, .demo/03-tests.tap이 있으면 실제 지적과 실패를 읽고 수정하세요. 성공·실패·일부 성공 상태가 모순되지 않아야 합니다.');
  await requireApprovedPlan(dir);
  const report = await requireScope(dir);
  if (!report.changed.length) throw new Error('Implementation produced no code changes.');
  await writeFile(metadata(dir, '02-implementation.md'), result.text);
  await writeFile(metadata(dir, '02-diff.patch'), await git(dir, 'diff', '--no-ext-diff', '--no-color', 'HEAD'));
  await updateState(dir, {
    implementation: { completedAt: result.completedAt, changed: report.changed, sourceDigest: await digest(dir), cliVersion: result.cliVersion },
    lastError: null,
  });
}

export function tapCounts(output) {
  const metric = (name) => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Expected one TAP ${name} total; inspect test output.`);
    return Number(matches[0][1]);
  };
  return { tests: metric('tests'), pass: metric('pass'), fail: metric('fail'), skipped: metric('skipped'), cancelled: metric('cancelled') };
}

async function suites(dir) {
  const specifications = [
    { name: 'repository', path: join(dir, 'tests/app.test.mjs') },
    { name: 'acceptance', path: join(ROOT, 'acceptance/duplicate-order.test.mjs') },
  ];
  const results = [];
  for (const suite of specifications) {
    const result = await run(process.execPath, ['--test', '--test-reporter=tap', suite.path], {
      cwd: dir, env: { DEMO_APP_PATH: join(dir, 'src/app.mjs') },
    });
    if (result.timedOut) throw new Error(`Test suite timed out: ${suite.name}`);
    results.push({ name: suite.name, exitCode: result.code, ...tapCounts(result.stdout), output: result.stdout + result.stderr });
  }
  return results;
}

export async function baseline(dir) {
  const state = await stateOf(dir);
  if (await digest(dir) !== state.baselineDigest) throw new Error('Baseline evidence must be recorded before source changes.');
  const results = await suites(dir);
  const summary = results.map(({ output, ...record }) => record);
  if (summary[0].exitCode !== 0 || summary[1].fail === 0) throw new Error('Baseline did not demonstrate existing tests passing and new requirements failing.');
  await writeFile(metadata(dir, '00-baseline.tap'), results.map((suite) => `# Suite: ${suite.name}\n${suite.output}`).join('\n'));
  await updateState(dir, { baselineTests: { recordedAt: now(), suites: summary }, lastError: null });
  return summary;
}

export async function verify(dir) {
  await requireApprovedPlan(dir);
  await updateState(dir, { verification: null, review: null, decision: null });
  const sourceDigest = await digest(dir);
  const report = await requireScope(dir);
  const results = await suites(dir);
  if (await digest(dir) !== sourceDigest) throw new Error('Source changed during verification.');
  const summary = {
    recordedAt: now(), sourceDigest, node: process.version, changed: report.changed,
    scopePassed: true, browserVerified: false,
    note: 'HTTP/HTML and repository tests only. Browser interaction is checked separately.',
    suites: results.map(({ output, ...record }) => record),
    passed: results.every((suite) => suite.exitCode === 0 && suite.fail === 0 && suite.skipped === 0 && suite.cancelled === 0),
  };
  await writeFile(metadata(dir, '03-tests.tap'), results.map((suite) => `# Suite: ${suite.name}\n${suite.output}`).join('\n'));
  await writeFile(metadata(dir, '02-diff.patch'), await git(dir, 'diff', '--no-ext-diff', '--no-color', 'HEAD'));
  await save(metadata(dir, '03-verification.json'), summary);
  await updateState(dir, { verification: summary, lastError: summary.passed ? null : 'Verification failed; review is blocked.' });
  if (!summary.passed) throw new Error('Verification failed. See .demo/03-tests.tap. Fix the code, not the acceptance criteria.');
  return summary;
}

export async function requireVerified(dir) {
  const state = await requireApprovedPlan(dir);
  if (!state.verification?.passed) throw new Error('STOP: successful verification is required.');
  if (state.verification.sourceDigest !== await digest(dir)) throw new Error('STOP: source changed after verification; re-run verification and review.');
  if (sha(await read(metadata(dir, '02-diff.patch'))) !== sha(await git(dir, 'diff', '--no-ext-diff', '--no-color', 'HEAD'))) {
    throw new Error('STOP: diff evidence no longer matches the source.');
  }
  return state;
}

export async function review(dir) {
  const state = await requireVerified(dir);
  await updateState(dir, { review: null, decision: null });
  const result = await invokeAgent(dir, 'reviewer',
    'REQUEST.md, .demo/01-plan.md, .demo/02-diff.patch, .demo/03-tests.tap, .demo/03-verification.json과 실제 변경된 파일을 읽고 검토하세요. .demo/06-browser-check.json이 있다면 sourceDigest가 현재 검증과 일치하는지 확인하고 실제 브라우저 기록도 검토하세요. 관측된 테스트와 아직 확인되지 않은 동작을 구분하세요. 승인하거나 파일을 수정하지 마세요.');
  if (await digest(dir) !== state.verification.sourceDigest) throw new Error('Read-only reviewer changed the source. Stop and investigate.');
  const match = result.text.match(/^RECOMMENDATION: (READY_FOR_HUMAN_REVIEW|CHANGES_REQUESTED)\s*$/m);
  await writeFile(metadata(dir, '04-review.md'), result.text);
  if (!match) throw new Error('Review recommendation is missing; inspect the actual response.');
  await updateState(dir, {
    review: { recommendation: match[1], sourceDigest: await digest(dir), hash: sha(result.text), completedAt: result.completedAt, cliVersion: result.cliVersion },
    lastError: null,
  });
}

export async function recordBrowser(dir) {
  const sourceDigest = await digest(dir);
  const report = await json(join(ROOT, '../evidence/browser-check.json'));
  if (report.sourceDigest !== sourceDigest) throw new Error('Browser evidence does not match the current source.');
  await save(metadata(dir, '06-browser-check.json'), report);
  const state = await stateOf(dir);
  const verification = state.verification ? {
    ...state.verification, browserVerified: report.passed,
    browserRecordedAt: report.recordedAt,
    note: report.passed ? 'Repository, HTTP acceptance and separately executed browser checks passed.' :
      'Repository and HTTP checks may pass, but a separate browser check failed. Read 06-browser-check.json.',
  } : null;
  if (verification) await save(metadata(dir, '03-verification.json'), verification);
  await updateState(dir, { verification, browserVerification: report, lastError: report.passed ? null : 'Browser check failed; inspect the recorded evidence.' });
  return { passed: report.passed, checks: report.checks.length, sourceDigest };
}

export async function decide(dir, { by, note, decision, rehearsal = false }) {
  if (!by?.trim() || !note?.trim()) throw new Error('Decision requires --by and --note.');
  if (!['approve', 'rework'].includes(decision)) throw new Error('--decision must be approve or rework.');
  const state = await requireVerified(dir);
  if (!state.review || state.review.sourceDigest !== await digest(dir)) throw new Error('STOP: a current review is required.');
  if (state.review.hash !== sha(await read(metadata(dir, '04-review.md')))) throw new Error('STOP: review artifact changed.');
  if (decision === 'approve' && state.review.recommendation !== 'READY_FOR_HUMAN_REVIEW') {
    throw new Error('STOP: the reviewer requested changes.');
  }
  const result = {
    decision, by, note, recordedAt: now(), sourceDigest: state.review.sourceDigest,
    kind: rehearsal ? 'rehearsal-decision' : 'presenter-decision', merged: false, deployed: false,
    disclaimer: 'Local demo record. This does not authenticate the actor, create a PR, or merge code.',
  };
  await save(metadata(dir, '05-decision.json'), result);
  await updateState(dir, { decision: result, lastError: null });
  return result;
}

export async function exportReference(dir) {
  await requireVerified(dir);
  const state = await stateOf(dir);
  if (!state.review) throw new Error('Reference requires a completed real Copilot review.');
  if (state.review.recommendation !== 'READY_FOR_HUMAN_REVIEW') throw new Error('Reference cannot be exported while changes are requested.');
  if (!state.verification.browserVerified || state.browserVerification?.sourceDigest !== await digest(dir)) {
    throw new Error('Reference requires passing browser evidence for the current source.');
  }
  if (state.decision) throw new Error('Keep the reference at the human-decision checkpoint; do not export an approved demonstration.');
  const target = join(ROOT, 'reference');
  if (await exists(target)) throw new Error('Reference already exists; refusing to overwrite it.');
  await mkdir(target);
  for (const file of await files(dir)) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await cp(join(dir, file), join(target, file));
  }
  await cp(metadata(dir, ''), metadata(target, ''), { recursive: true });
  await save(metadata(target, 'origin.json'), {
    exportedAt: now(), origin: state.id, sourceDigest: await digest(dir),
    kind: 'saved-real-copilot-rehearsal', humanFinalApproval: false,
    note: 'Replay uses saved real outputs, not a new model run. Source and event contents are not generated by a mock.',
  });
  const manifest = {};
  async function visit(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), relative);
      else if (entry.isFile()) manifest[relative] = sha(await readFile(join(path, entry.name)));
      else throw new Error(`Unsupported reference entry: ${relative}`);
    }
  }
  await visit(target);
  await save(join(ROOT, 'reference-manifest.json'), { createdAt: now(), files: manifest });
}

export async function checkReference({ executeTests = false } = {}) {
  const manifest = await json(join(ROOT, 'reference-manifest.json'));
  const dir = join(ROOT, 'reference');
  for (const [file, expected] of Object.entries(manifest.files)) {
    const path = resolve(dir, file);
    const relativePath = relative(dir, path);
    if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      throw new Error(`Invalid reference manifest path: ${file}`);
    }
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Reference symlink is not allowed: ${file}`);
    if (sha(await readFile(path)) !== expected) throw new Error(`Reference integrity check failed: ${file}`);
  }
  const expectedSource = Object.keys(manifest.files).filter((file) => !file.startsWith('.demo/')).sort();
  if (JSON.stringify((await files(dir)).sort()) !== JSON.stringify(expectedSource)) {
    throw new Error('Unexpected source files exist in the reference.');
  }
  const state = await stateOf(dir);
  if (await digest(dir) !== state.verification?.sourceDigest) throw new Error('Reference source does not match the verified source.');
  if (executeTests) {
    const results = await suites(dir);
    for (const suite of results) console.log(`${suite.name}: ${suite.pass}/${suite.tests} passing`);
    if (results.some((suite) => suite.exitCode || suite.fail || suite.skipped || suite.cancelled)) {
      throw new Error('Reference test rerun failed.');
    }
  }
  return { files: Object.keys(manifest.files).length, sourceDigest: state.verification.sourceDigest };
}

export async function serve(id, port = 4310) {
  const dir = workspace(id);
  if (id === 'reference') await checkReference();
  await stateOf(dir);
  let appHash, handler;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'GET' && (url.pathname === '/presenter' || url.pathname.startsWith('/__demo/'))) {
        res.writeHead(405); res.end('Read-only evidence endpoint'); return;
      }
      const send = (type, value) => {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(value);
      };
      if (url.pathname === '/presenter') {
        send('text/html; charset=utf-8', await read(join(ROOT, 'scripts/presenter.html')));
      } else if (url.pathname === '/__demo/evidence') {
        const state = await stateOf(dir);
        const artifacts = {};
        for (const file of ARTIFACTS) {
          if (await exists(metadata(dir, file))) artifacts[file] = await read(metadata(dir, file));
        }
        const firstReview = metadata(dir, 'history/iteration-01/04-review.md');
        if (await exists(firstReview)) artifacts['first-review.md'] = await read(firstReview);
        send('application/json; charset=utf-8', JSON.stringify({
          state, artifacts, request: await read(join(dir, 'REQUEST.md')),
          saved: id === 'reference', currentDigest: await digest(dir),
        }));
      } else {
        const current = sha(await readFile(join(dir, 'src/app.mjs')));
        if (current !== appHash) {
          handler = (await import(`${pathToFileURL(join(dir, 'src/app.mjs'))}?version=${current}`)).handleRequest;
          appHash = current;
        }
        await handler(req, res);
      }
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Demo error: ${error.message}`);
    }
  });
  server.on('error', (error) => { console.error(`Server failed: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    console.log(`Order Recovery Desk: http://127.0.0.1:${actualPort}/`);
    console.log(`Evidence desk: http://127.0.0.1:${actualPort}/presenter`);
    console.log(id === 'reference' ? 'SAVED REHEARSAL: no new Copilot request; no final human approval.' : `LIVE WORKSPACE: ${id}; local helper UI, not GitHub product UI.`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  return server;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { by: { type: 'string' }, note: { type: 'string' }, rehearsal: { type: 'boolean' },
      decision: { type: 'string' }, port: { type: 'string', default: '4310' } },
  });
  const [command = 'help', id] = positionals;
  if (command === 'help') {
    console.log(`Usage: npm run demo -- COMMAND RUN-ID [options]
  prepare live          Create a fresh local Git workspace (never overwrite).
  baseline live         Record old tests green / new acceptance criteria red.
  plan live             Invoke the actual read-only Copilot planning agent.
  approve-plan live --by presenter --note "Reviewed scope"
  implement live        Invoke Copilot; requires recorded scope approval.
  verify live           Execute repository + human-owned acceptance tests.
  review live           Invoke read-only Copilot review on current evidence.
  record-browser live   Attach evidence/browser-check.json for this source.
  decision live --decision approve|rework --by presenter --note "Reason"
  serve live            Serve the app and /presenter (127.0.0.1:4310).
  serve reference       Offline saved rehearsal; no model calls.
  check-reference       Check integrity and re-run reference tests.
  export-reference ID   Export a verified real run at the final human gate.
Use --rehearsal to label a simulated approval honestly. No command creates a
GitHub PR, pushes, merges, or deploys. Copilot commands use authenticated
Copilot services over the network.`);
    return;
  }
  if (command === 'check-reference') {
    console.log(await checkReference({ executeTests: true })); return;
  }
  const commands = new Set(['prepare', 'baseline', 'plan', 'approve-plan', 'implement', 'verify', 'review', 'record-browser', 'decision', 'serve', 'export-reference']);
  if (!commands.has(command)) throw new Error(`Unknown command: ${command}`);
  const dir = workspace(id);
  if (command === 'prepare') { console.log(`Prepared ${await prepare(id)}`); return; }
  if (id === 'reference' && command !== 'serve') throw new Error('The saved reference is read-only.');
  if (command === 'serve') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
    await serve(id, port); return;
  }
  await stateOf(dir);
  try {
    const actions = { baseline, plan, 'approve-plan': (path) => approvePlan(path, values),
      implement, verify, review, 'record-browser': recordBrowser, decision: (path) => decide(path, values), 'export-reference': exportReference };
    const result = await actions[command](dir);
    console.log(`${command}: complete${result ? `\n${JSON.stringify(result, null, 2)}` : ''}`);
  } catch (error) {
    await updateState(dir, { lastError: error.message });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
