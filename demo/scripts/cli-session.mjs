import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const exec = promisify(execFile);
export const APPROVAL = 'APPROVE ORDER-001';

export function cliConfig(dir) {
  return {
    defaultMode: 'interactive', defaultPermissionMode: 'manual',
    trustedFolders: [dir], banner: 'always', bannerStyle: 'classic',
    showTipsOnStartup: false, memory: false, disableAllHooks: true,
    customAgents: { defaultLocalOnly: true },
    ide: { autoConnect: false, openDiffOnEdit: false },
    notifications: false, terminalProgress: false, updateTerminalTitle: false,
    theme: 'github', mouse: false, tabs: { enabled: false },
  };
}

export async function interactiveEnvironment(dir) {
  const home = join(dir, '.demo', 'cli-home');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'config.json'), `${JSON.stringify(cliConfig(dir), null, 2)}\n`);
  let token = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    try {
      token = (await exec('gh', ['auth', 'token'])).stdout.trim();
    } catch {
      throw new Error('Interactive demo authentication is unavailable. Log in with gh auth login, or supply COPILOT_GITHUB_TOKEN in the environment. No token is saved by this helper.');
    }
  }
  if (!token) throw new Error('No authentication token is available for the actual Copilot CLI.');
  const env = {
    ...process.env, COPILOT_HOME: home, COPILOT_GITHUB_TOKEN: token,
    COPILOT_ALLOW_ALL: 'false', COPILOT_ASSISTED_APPROVAL: 'false',
    COPILOT_AUTO_UPDATE: 'false', TERM: process.env.TERM || 'xterm-256color',
  };
  for (const key of ['NO_COLOR', 'COPILOT_CUSTOM_INSTRUCTIONS_DIRS', 'COPILOT_PROVIDER_BASE_URL',
    'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_PROVIDER_BEARER_TOKEN']) {
    delete env[key];
  }
  return env;
}

export async function runInteractive(dir, args, sessionId) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive Copilot requires a terminal. Run this command in a terminal, not a pipe.');
  }
  const env = await interactiveEnvironment(dir);
  const code = await new Promise((resolve, reject) => {
    const child = spawn('copilot', args, { cwd: dir, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      if (signal) reject(new Error(`Interactive Copilot ended with ${signal}; no success was substituted.`));
      else resolve(status);
    });
  });
  const events = join(env.COPILOT_HOME, 'session-state', sessionId, 'events.jsonl');
  let stdout;
  try {
    stdout = await readFile(events, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Copilot did not produce session evidence (exit ${code}). Check authentication and CLI compatibility.`);
  }
  return { code, stdout, stderr: '', timedOut: false, signal: null };
}

export async function askScopeApproval({ input = process.stdin, output = process.stdout } = {}) {
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(`\n[HUMAN GATE] Type ${APPROVAL} to approve the four-file plan; anything else stops:\n> `);
    if (answer.trim() !== APPROVAL) throw new Error('STOP: scope was not approved. No implementation agent was started.');
    return answer.trim();
  } finally {
    prompt.close();
  }
}
