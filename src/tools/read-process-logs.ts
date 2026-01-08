import { tool } from 'ai';
import { z } from 'zod';
import { getProcesses, getProcessLogs } from '../utils/processes.js';

export const readProcessLogs = tool({
  description:
    'Read recent logs/output from a background process. Use this to check for errors or see what a dev server is outputting.',
  inputSchema: z.object({
    pid: z
      .number()
      .optional()
      .describe('Process ID. If not provided, returns logs from most recent process'),
    lines: z
      .number()
      .optional()
      .describe('Number of lines to return (default: 50)'),
  }),
  execute: async ({ pid, lines = 50 }) => {
    let targetPid = pid;

    if (!targetPid) {
      const procs = getProcesses();
      if (procs.length === 0) {
        return { error: 'No background processes running' };
      }
      targetPid = procs[procs.length - 1].pid;
    }

    const logs = getProcessLogs(targetPid, lines);

    if (logs.length === 0) {
      return { pid: targetPid, logs: [], message: 'No output yet' };
    }

    return { pid: targetPid, logs, lineCount: logs.length };
  },
});

