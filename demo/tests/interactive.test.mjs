import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { agentArguments } from '../scripts/workflow.mjs';
import { APPROVAL, askScopeApproval, cliConfig } from '../scripts/cli-session.mjs';

test('interactive implementation shows native edit approvals, never blanket permission', () => {
  const args = agentArguments('/demo/run', 'implementer', 'scoped request', {
    interactive: true, sessionId: 'test-session',
  });
  assert.ok(args.includes('--interactive'));
  assert.ok(args.includes('--session-id'));
  assert.ok(args.includes('--deny-tool=shell'));
  assert.ok(args.includes('--deny-tool=url'));
  assert.ok(!args.some((arg) => arg.startsWith('--allow-') || arg === '--no-ask-user' || arg === '--no-color'));
  assert.throws(() => agentArguments('/demo/run', 'implementer', 'request', { interactive: true }), /session ID/);
  assert.throws(() => agentArguments('/demo/run', 'unknown', 'request'), /Unknown agent/);
});

test('read-only roles still deny writes in the native CLI', () => {
  for (const role of ['planner', 'reviewer']) {
    const args = agentArguments('/demo/run', role, 'request', { interactive: true, sessionId: 'test' });
    assert.ok(args.includes('--deny-tool=write'));
  }
});

test('existing programmatic invocation retains exact scoped write grants', () => {
  const args = agentArguments('/demo/run', 'implementer', 'request');
  assert.ok(args.includes('--prompt'));
  assert.ok(args.includes('--output-format'));
  assert.equal(args.filter((arg) => arg.startsWith('--allow-tool=write(')).length, 4);
  assert.ok(args.includes('--allow-tool=write(/demo/run/src/app.mjs)'));
});

test('the dedicated CLI home starts in manual mode without global hooks or IDE edits', () => {
  const config = cliConfig('/demo/run');
  assert.equal(config.defaultPermissionMode, 'manual');
  assert.equal(config.defaultMode, 'interactive');
  assert.equal(config.disableAllHooks, true);
  assert.equal(config.ide.autoConnect, false);
  assert.deepEqual(config.trustedFolders, ['/demo/run']);
  assert.equal(config.memory, false);
  assert.equal(config.model, undefined);
});

test('scope gate waits for the exact approval phrase and rejects ordinary yes', async () => {
  for (const [answer, approved] of [[APPROVAL, true], ['yes', false], ['', false], ['CANCEL', false]]) {
    const input = new PassThrough();
    const output = new PassThrough();
    const waiting = askScopeApproval({ input, output });
    input.write(`${answer}\n`);
    if (approved) assert.equal(await waiting, APPROVAL);
    else await assert.rejects(waiting, /No implementation agent was started/);
    input.end();
    output.end();
  }
});
