import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tapCounts } from '../demo/scripts/workflow.mjs';

const root = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
  'demo/tests/workflow.test.mjs', 'demo/tests/interactive.test.mjs'], {
  cwd: root, encoding: 'utf8', timeout: 60000,
});
if (result.error) throw result.error;
const output = result.stdout + result.stderr;
const counts = tapCounts(result.stdout);
const report = {
  recordedAt: new Date().toISOString(), exitCode: result.status, ...counts,
  passed: result.status === 0 && counts.fail === 0 && counts.skipped === 0,
  scope: 'Controller unit tests with explicitly synthetic fixture plans; not Copilot conversation evidence.',
  checks: [...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map((match) => match[1]),
};
await mkdir(resolve(root, 'evidence'), { recursive: true });
await writeFile(resolve(root, 'evidence/controller-tests.tap'), output);
await writeFile(resolve(root, 'evidence/control-check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
