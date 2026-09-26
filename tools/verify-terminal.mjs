import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { digest, ALLOWED } from '../demo/scripts/workflow.mjs';

const root = resolve(import.meta.dirname, '..');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const edit = await json('video/terminal/edit.json');
const state = await json('demo/cli-reference/.demo/state.json');
const rendering = await json('evidence/terminal-render.json');
const narrative = await json('video/narration.json');
const report = {
  recordedAt: new Date().toISOString(), runId: edit.runId, captures: [], nativeApprovals: 0,
  sourceDigest: await digest(join(root, 'demo/cli-reference')),
  approvalInputOrigin: 'automated-rehearsal', humanApproval: false,
};
assert.equal(state.id, edit.runId);
assert.equal(state.verification.passed, true);
assert.equal(state.verification.browserVerified, true);
assert.equal(state.review.recommendation, 'READY_FOR_HUMAN_REVIEW');
assert.equal(state.decision, null);
assert.equal(report.sourceDigest, state.verification.sourceDigest);
assert.equal(report.sourceDigest, state.review.sourceDigest);
assert.equal(report.sourceDigest, state.browserVerification.sourceDigest);
assert.equal(state.planApproval.kind, 'rehearsal-scope-approval');
const sessions = new Set();
const texts = new Map();
let scopeApprovals = 0;
for (const id of edit.captures) {
  assert.match(id, /^[a-z0-9][a-z0-9-]{0,59}$/);
  const folder = `video/terminal/${id}`;
  const capture = await json(`${folder}/capture.json`);
  const raw = await readFile(join(root, folder, 'session.cast'), 'utf8');
  const sha256 = createHash('sha256').update(raw).digest('hex');
  assert.equal(sha256, capture.castSha256, `Raw output changed: ${id}`);
  assert.equal(sha256, rendering.captures[id], `Rendered clip is stale: ${id}`);
  assert.equal(capture.runId, edit.runId);
  assert.equal(capture.inputOrigin, 'automated-rehearsal');
  assert.equal(capture.humanApproval, false);
  assert.equal(typeof capture.exitCode, 'number', 'A truncated recording cannot be used.');
  assert.equal(capture.error, undefined);
  const [header, ...events] = raw.trimEnd().split('\n').map(JSON.parse);
  assert.equal(header.version, 2);
  assert.equal(header.width, capture.width);
  assert.equal(header.height, capture.height);
  let last = -1;
  for (const [at, kind, output] of events) {
    assert.ok(at >= last && at >= 0);
    assert.equal(kind, 'o');
    assert.equal(typeof output, 'string');
    last = at;
  }
  const plain = stripVTControlCharacters(events.map(event => event[2]).join(''));
  assert.doesNotMatch(plain, /\b(?:gh[opusr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/,
    'Do not distribute a recording containing an authentication token.');
  texts.set(id, plain);
  for (const stage of capture.stages) sessions.add(stage.sessionId);
  const actions = (await readFile(join(root, folder, 'actions.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const action of actions) {
    assert.equal(action.origin, 'automated-rehearsal');
    assert.ok(action.at >= 0 && action.at <= capture.durationSeconds);
    if (action.kind === 'native-approve-once') {
      assert.equal(action.input, '\r');
      assert.ok(action.evidence.paths.length > 0);
      assert.ok(action.evidence.paths.every(path => ALLOWED.includes(path)));
      assert.match(plain, /Do you want to update/);
      assert.match(plain, /1\.\s*Yes/);
      report.nativeApprovals++;
    } else if (action.kind === 'scope-approval-rehearsal') {
      assert.equal(action.input, 'APPROVE ORDER-001\r');
      scopeApprovals++;
    } else {
      assert.equal(action.kind, 'exit-completed-agent');
      assert.equal(action.input, '/exit\r');
    }
  }
  report.captures.push({ id, sha256, rawSeconds: capture.durationSeconds,
    exitCode: capture.exitCode, workflowSucceeded: capture.exitCode === 0,
    nativeApprovals: capture.nativePermissions.length });
}
assert.equal(scopeApprovals, 1);
assert.ok(report.nativeApprovals >= 4);
assert.match(texts.get(edit.runId), /BLOCKED BEFORE APPROVAL/);
assert.match(texts.get(edit.runId), /HUMAN GATE/);
for (const role of ['planner', 'implementer', 'reviewer']) {
  const invocation = await json(`demo/cli-reference/.demo/logs/${role}.invocation.json`);
  assert.equal(invocation.command, 'copilot');
  assert.equal(invocation.interactive, true);
  assert.ok(invocation.args.includes('--interactive'));
  assert.ok(sessions.has(invocation.sessionId), `Final ${role} is not among the actual recordings.`);
  assert.ok(!invocation.args.some(arg => arg.startsWith('--allow-all') || arg.startsWith('--allow-tool=write') ||
    arg === '--yolo' || arg === '--no-ask-user' || arg === '--autopilot'));
}
const first = await json('demo/cli-reference/.demo/history/iteration-01/state.json');
assert.equal(first.verification.passed, true);
assert.equal(first.browserVerification.passed, false);
const failedRework = await json('demo/cli-reference/.demo/history/iteration-02/state.json');
assert.equal(failedRework.verification.passed, false);
assert.ok(report.captures.some(capture => capture.exitCode !== 0), 'Preserve the actual failed rework, not only successful takes.');
for (const scene of edit.scenes) {
  const planned = narrative.scenes.find(item => item.id === scene.id);
  assert.equal(planned.kind, 'terminal');
  const clip = rendering.clips.find(item => item.scene === scene.id);
  assert.ok(clip);
  assert.equal(clip.duration, planned.duration);
  assert.equal(scene.segments.reduce((total, part) => total + part.duration, 0), planned.duration);
  for (const part of scene.segments) assert.ok(edit.captures.includes(part.capture || edit.runId));
}
assert.ok(rendering.snapshots.some(snapshot => snapshot.visibleText.includes('Do you want to update') &&
  snapshot.visibleText.includes('1. Yes')), 'The actual native approval UI must be visible, not only a helper summary.');
assert.ok(rendering.snapshots.some(snapshot => snapshot.visibleText.includes('demo-planner')));
assert.ok(rendering.snapshots.some(snapshot => snapshot.visibleText.includes('demo-reviewer')));
assert.ok(rendering.snapshots.some(snapshot => /repository.*17\s*│\s*17/.test(snapshot.visibleText) &&
  /acceptance.*16\s*│\s*16/.test(snapshot.visibleText)), 'The actual final test totals must be legible in a recorded frame.');
assert.ok(rendering.snapshots.some(snapshot => snapshot.visibleText.includes('[FINAL HUMAN GATE]')));
report.terminalSeconds = narrative.scenes.filter(scene => scene.kind === 'terminal').reduce((total, scene) => total + scene.duration, 0);
report.totalSeconds = narrative.totalSeconds;
report.terminalShare = report.terminalSeconds / report.totalSeconds;
assert.ok(report.terminalShare >= .7);
report.passed = true;
await writeFile(join(root, 'evidence/terminal-check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
