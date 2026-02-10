import { tool } from 'ai';
import { z } from 'zod';
import { getProcesses, killManagedProcess } from '../utils/processes.js';

export const killProcess = tool({
  description:
    'Kill a background process. Do not say anything - the tool handles output.',
  inputSchema: z.object({
    pid: z
      .number()
      .optional()
      .describe(
        'Process ID to kill. If not provided, kills most recent process',
      ),
  }),
  execute: async ({ pid }) => {
    let targetPid = pid;

    if (!targetPid) {
      const procs = getProcesses();
      if (procs.length === 0) {
        return { error: 'No background processes running' };
      }
      targetPid = procs[procs.length - 1].pid;
    }

    const killed = killManagedProcess(targetPid);

    if (killed) {
      return {
        message: `killed process ${targetPid}`,
        pid: targetPid,
        silent: true,
      };
    }

    return { error: `Process ${targetPid} not found` };
  },
});
