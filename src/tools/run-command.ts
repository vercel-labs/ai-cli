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
let activeResolve: ((v: unknown) => void) | null = null;

/** Kill the currently running command and immediately resolve its promise. */
export function killRunningCommand(): void {
  const proc = activeProc;
  const resolve = activeResolve;
  activeProc = null;
  activeResolve = null;

  if (proc?.pid) {
    // Kill the entire process group (shell + children like npm)
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // Process might already be dead
      try {
        proc.kill('SIGKILL');
      } catch {}
    }
  }

  // Immediately resolve so the stream can finish
  if (resolve) {
    resolve({ error: 'Command cancelled by user. Do not retry.' });
  }
}

export const runCommand = tool({
  description:
    'Run shell commands. Use for: date, pwd, ls, git, package manager commands, build, test, etc. ALWAYS use the project package manager from the system prompt (pnpm/bun/yarn) — NEVER default to npm. NEVER use for dev/start/watch/serve - those need startProcess.',
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
      let resolved = false;

      const done = (value: unknown) => {
        if (resolved) return;
        resolved = true;
        activeProc = null;
        activeResolve = null;
        resolve(value);
      };

      const proc = spawn(command, {
        cwd,
        shell: true,
        detached: true, // Create process group so we can kill the whole tree
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      activeProc = proc;
      activeResolve = done;

      // Don't let the detached process keep Node alive if we exit
      proc.unref();

      const killProc = () => {
        const pid = proc.pid;
        if (pid) {
          try {
            process.kill(-pid, 'SIGTERM');
          } catch {
            proc.kill('SIGTERM');
          }
        } else {
          proc.kill('SIGTERM');
        }
      };

      const checkInactivity = setInterval(() => {
        if (Date.now() - lastActivity > INACTIVITY) {
          killed = true;
          killProc();
          clearInterval(checkInactivity);
        }
      }, 5000);

      const totalTimeout = setTimeout(() => {
        killed = true;
        killProc();
      }, TIMEOUT);

      const onData = (data: Buffer) => {
        lastActivity = Date.now();
        chunks.push(data.toString());
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('close', (code) => {
        clearInterval(checkInactivity);
        clearTimeout(totalTimeout);

        const output = mask(chunks.join('').trim());
        const result = output ? `$ ${command}\n${output}` : `$ ${command}`;

        if (killed) {
          done({ error: 'Command cancelled', output: result });
        } else if (code === 0) {
          done({ output: result, silent: true });
        } else {
          done({ output: result, exitCode: code });
        }
      });

      proc.on('error', (err) => {
        clearInterval(checkInactivity);
        clearTimeout(totalTimeout);
        done({ error: err.message, output: `$ ${command}` });
      });
    });
  },
});
