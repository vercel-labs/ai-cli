import { tool } from 'ai';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { startManagedProcess, getProcessLogs } from '../utils/processes.js';

export const startProcess = tool({
  description:
    'Start long-running background process. USE THIS for: dev, start, serve, watch, preview. Returns immediately with pid.',
  inputSchema: z.object({
    command: z.string().describe('Command to run'),
  }),
  execute: async ({ command }) => {
    debug(`startProcess: ${command}`);
    const proc = startManagedProcess(command);

    let url = '';
    for (let i = 0; i < 10; i++) {
      const logs = getProcessLogs(proc.pid, 50);
      for (const line of logs) {
        const match = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/i);
        if (match) {
          url = match[0];
          break;
        }
      }
      if (url) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const info = url ? `${command} → ${url}` : command;
    return { message: `${info} (pid: ${proc.pid})`, pid: proc.pid, url, silent: true };
  },
});
