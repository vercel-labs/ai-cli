import { type ChildProcess, spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { mask } from '../utils/mask.js';
import { confirm } from './confirm.js';

const cwd = process.cwd();
const TIMEOUT = 60000;
const INACTIVITY = 30000;

let activeProc: ChildProcess | null = null;

/** Kill the currently running command, if any. */
export function killRunningCommand(): void {
  if (activeProc) {
    activeProc.kill('SIGTERM');
    activeProc = null;
  }
}

export const runCommand = tool({
  description:
    'Run shell commands. Use for: date, pwd, ls, git, npm/bun commands, build, test, etc. NEVER use for dev/start/watch/serve - those need startProcess.',
  inputSchema: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async ({ command }) => {
    const lower = command.toLowerCase();
    const blocked = ['dev', 'start', 'serve', 'watch', 'preview'];
    if (blocked.some((b) => lower.includes(b))) {
      return { error: 'use startProcess for long-running commands' };
    }

    const ok = await confirm(`Run: ${command}?`, {
      tool: 'runCommand',
      command,
    });
    if (!ok) {
      return { error: 'User denied this action. Do not retry.' };
    }

    debug(`runCommand: ${command}`);

    return new Promise((resolve) => {
      const chunks: string[] = [];
      let lastActivity = Date.now();
      let killed = false;

      const proc = spawn(command, {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      activeProc = proc;

      const checkInactivity = setInterval(() => {
        if (Date.now() - lastActivity > INACTIVITY) {
          killed = true;
          proc.kill('SIGTERM');
          clearInterval(checkInactivity);
        }
      }, 5000);

      const totalTimeout = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, TIMEOUT);

      const onData = (data: Buffer) => {
        lastActivity = Date.now();
        chunks.push(data.toString());
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('close', (code) => {
        activeProc = null;
        clearInterval(checkInactivity);
        clearTimeout(totalTimeout);

        const output = mask(chunks.join('').trim());
        const result = output ? `$ ${command}\n${output}` : `$ ${command}`;

        if (killed) {
          resolve({ error: 'Command cancelled', output: result });
        } else if (code === 0) {
          resolve({ output: result, silent: true });
        } else {
          resolve({ output: result, exitCode: code });
        }
      });

      proc.on('error', (err) => {
        activeProc = null;
        clearInterval(checkInactivity);
        clearTimeout(totalTimeout);
        resolve({ error: err.message, output: `$ ${command}` });
      });
    });
  },
});
