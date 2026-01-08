import { getProcesses, killManagedProcess } from '../../utils/processes.js';
import type { CommandHandler } from './types.js';

function formatUptime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export const processes: CommandHandler = (_ctx, args) => {
  const procs = getProcesses();

  if (procs.length === 0) {
    return { output: 'no background processes' };
  }

  const action = args?.trim().toLowerCase();

  if (action === 'kill' || action === 'killall') {
    for (const p of procs) {
      killManagedProcess(p.pid);
    }
    return { output: `killed ${procs.length} process(es)` };
  }

  const num = Number.parseInt(action || '', 10);
  if (!Number.isNaN(num)) {
    const proc = procs.find((p) => p.pid === num);
    if (proc) {
      killManagedProcess(proc.pid);
      return { output: `killed process ${num}` };
    }
    return { output: `process ${num} not found` };
  }

  const lines = ['background processes:'];
  for (const p of procs) {
    const uptime = formatUptime(p.startedAt);
    lines.push(`  ${p.pid} - ${p.command} (${uptime})`);
  }
  lines.push('\n/processes <pid> to kill, /processes killall to kill all');
  return { output: lines.join('\n') };
};

