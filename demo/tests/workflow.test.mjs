import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, workspace, prepare, digest, scope, approvePlan, requireApprovedPlan, requireVerified,
  decide, extractFinal, tapCounts } from '../scripts/workflow.mjs';

const root = await mkdtemp(join(tmpdir(), 'agentic-demo-test-'));
await mkdir(join(root, 'starter'));
await cp(join(ROOT, 'starter'), join(root, 'starter'), { recursive: true });
after(() => rm(root, { recursive: true, force: true }));
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function setState(dir, update) {
  const file = join(dir, '.demo/state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...state, ...update }));
}
async function planned(id) {
  const dir = await prepare(id, root);
  const text = '# Fixture plan used by unit tests, not Copilot evidence\n';
  await writeFile(join(dir, '.demo/01-plan.md'), text);
  await setState(dir, { plan: { hash: hash(text) } });
  return dir;
}

test('workspace identifiers reject traversal and absolute paths', () => {
  for (const id of ['../other', '/tmp/other', '', 'live/other', '..']) {
    assert.throws(() => workspace(id, root));
  }
  assert.equal(workspace('live-01', root), join(root, 'runs/live-01'));
});

test('prepare never overwrites an existing workspace', async () => {
  await prepare('existing', root);
  await assert.rejects(prepare('existing', root), /already exists/);
  await assert.rejects(prepare('reference', root), /immutable/);
});

test('implementation is blocked before scope approval', async () => {
  const dir = await planned('unapproved');
  await assert.rejects(requireApprovedPlan(dir), /approval is missing/);
});

test('approval requires an explicit actor and reason', async () => {
  const dir = await planned('actor');
  await assert.rejects(approvePlan(dir, { by: '', note: '' }), /--by and --note/);
});

test('rehearsal approval is labeled and becomes invalid if the plan changes', async () => {
  const dir = await planned('stale-plan');
  const result = await approvePlan(dir, { by: 'unit-test', note: 'test only', rehearsal: true });
  assert.equal(result.kind, 'rehearsal-scope-approval');
  await requireApprovedPlan(dir);
  await writeFile(join(dir, '.demo/01-plan.md'), 'different plan');
  await assert.rejects(requireApprovedPlan(dir), /plan changed/);
});

test('the request cannot change silently after approval', async () => {
  const dir = await planned('stale-request');
  await approvePlan(dir, { by: 'unit-test', note: 'test only', rehearsal: true });
  await writeFile(join(dir, 'REQUEST.md'), 'changed scope');
  await assert.rejects(requireApprovedPlan(dir), /request changed/);
});

test('scope check detects protected and newly added files', async () => {
  const dir = await planned('scope');
  await approvePlan(dir, { by: 'unit-test', note: 'test only', rehearsal: true });
  await writeFile(join(dir, 'src/data.mjs'), 'export const requests = [];');
  await writeFile(join(dir, 'unexpected.txt'), 'not allowed');
  assert.deepEqual((await scope(dir)).violations, ['src/data.mjs', 'unexpected.txt']);
  await assert.rejects(requireApprovedPlan(dir), /Out-of-scope/);
});

test('missing or failed tests block review', async () => {
  const dir = await planned('no-tests');
  await approvePlan(dir, { by: 'unit-test', note: 'test only', rehearsal: true });
  await assert.rejects(requireVerified(dir), /successful verification/);
  await setState(dir, { verification: { passed: false } });
  await assert.rejects(requireVerified(dir), /successful verification/);
});

test('a source change invalidates previously recorded verification', async () => {
  const dir = await planned('stale-code');
  await approvePlan(dir, { by: 'unit-test', note: 'test only', rehearsal: true });
  await setState(dir, { verification: { passed: true, sourceDigest: await digest(dir) } });
  await writeFile(join(dir, 'src/app.mjs'), '// changed after tests');
  await assert.rejects(requireVerified(dir), /source changed after verification/);
});

test('final decision cannot bypass a missing review', async () => {
  const dir = await planned('no-review');
  await approvePlan(dir, { by: 'unit-test', note: 'test only', rehearsal: true });
  await writeFile(join(dir, '.demo/02-diff.patch'), '');
  await setState(dir, { verification: { passed: true, sourceDigest: await digest(dir) } });
  await assert.rejects(decide(dir, { by: 'unit-test', note: 'test only', decision: 'approve' }), /current review/);
});

test('JSONL extraction uses the actual final message and rejects missing evidence', () => {
  const output = [
    JSON.stringify({ type: 'assistant.message', data: { content: 'intermediate' } }),
    JSON.stringify({ type: 'assistant.message', data: { content: 'final' } }),
  ].join('\n');
  assert.equal(extractFinal(output), 'final\n');
  assert.throws(() => extractFinal('{"type":"session.start"}'), /No final/);
  assert.throws(() => extractFinal('not-json'), /JSONL/);
});

test('TAP counts must exist and cannot silently default to success', () => {
  assert.deepEqual(tapCounts('# tests 3\n# pass 2\n# fail 1\n# skipped 0\n# cancelled 0\n'), { tests: 3, pass: 2, fail: 1, skipped: 0, cancelled: 0 });
  assert.throws(() => tapCounts(''), /Expected one TAP/);
});
