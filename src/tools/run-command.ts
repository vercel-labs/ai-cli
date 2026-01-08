import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';

const cwd = process.cwd();
const TIMEOUT = 60000;
const INACTIVITY = 30000;

export const runCommand = tool({
  description:
    'Run a command that exits quickly (build, install, test, lint, git). NEVER use for dev/start/watch/serve - those need startProcess.',
  inputSchema: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async ({ command }) => {
    const lower = command.toLowerCase();
    const blocked = ['dev', 'start', 'serve', 'watch', 'preview'];
    if (blocked.some((b) => lower.includes(b))) {
      return { error: 'use startProcess for long-running commands' };
    }

    debug(`runCommand: ${command}`);
    process.stdout.write(`\r\x1b[K${dim(`$ ${command}`)}\n`);

    return new Promise((resolve) => {
      const chunks: string[] = [];
      let lastActivity = Date.now();
      let killed = false;

      const proc = spawn(command, {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
        clearInterval(checkInactivity);
        clearTimeout(totalTimeout);

        const output = chunks.join('').trim();
        if (output) console.log(dim(output));

        if (killed) {
          console.log(dim('timed out.'));
          resolve({ error: 'Command timed out', output });
        } else if (code === 0) {
          console.log(dim('done.'));
          resolve({ success: true, output, silent: true });
        } else {
          console.log(dim(`exit ${code}`));
          resolve({ error: `Exit code ${code}`, output });
        }
      });

      proc.on('error', (err) => {
        clearInterval(checkInactivity);
        clearTimeout(totalTimeout);
        resolve({ error: err.message });
      });
    });
  },
});

