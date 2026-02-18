import {
  clearExitedProcesses,
  getProcessLogs,
  getProcesses,
  getRunningProcesses,
  isRunning,
  killManagedProcess,
} from '../../utils/processes.js';
import type { CommandHandler } from './types.js';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export const processes: CommandHandler = (_ctx, args) => {
  const procs = getProcesses();
  const action = args?.trim().toLowerCase();

  // --- subcommands that don't require processes to exist ---

  if (action === 'clear') {
    clearExitedProcesses();
    return { output: 'cleared exited processes' };
  }

  if (procs.length === 0) {
    return { output: 'no background processes' };
  }

  // --- kill / killall ---

  if (action === 'kill' || action === 'killall') {
    const running = getRunningProcesses();
    for (const p of running) {
      killManagedProcess(p.pid);
    }
    clearExitedProcesses();
    const n = running.length;
    return {
      output:
        n > 0 ? `killed ${n} process(es)` : 'no running processes to kill',
    };
  }

  // --- logs [pid] ---

  if (action === 'logs' || action?.startsWith('logs ')) {
    const rest = action.slice(4).trim();
    let target = procs[procs.length - 1];
    if (rest) {
      const pid = Number.parseInt(rest, 10);
      if (!Number.isNaN(pid)) {
        const found = procs.find((p) => p.pid === pid);
        if (!found) return { output: `process ${pid} not found` };
        target = found;
      }
    }
    const logs = getProcessLogs(target.pid, 20);
    if (logs.length === 0) {
      return { output: `no output from process ${target.pid}` };
    }
    return {
      output: `logs for ${target.pid} (${target.command}):\n${logs.join('\n')}`,
    };
  }

  // --- kill by pid ---

  const num = Number.parseInt(action || '', 10);
  if (!Number.isNaN(num)) {
    const proc = procs.find((p) => p.pid === num);
    if (!proc) return { output: `process ${num} not found` };
    if (!isRunning(proc)) return { output: `process ${num} already exited` };
    killManagedProcess(proc.pid);
    return { output: `killed process ${num}` };
  }

  // --- list ---

  const lines = ['background processes:'];
  for (const p of procs) {
    if (isRunning(p)) {
      const uptime = formatDuration(Date.now() - p.startedAt);
      lines.push(`  ${p.pid}  ${p.command} (${uptime})`);
    } else {
      const ago = formatDuration(Date.now() - (p.exitedAt ?? Date.now()));
      lines.push(`  ${p.pid}  ${p.command} (exited ${p.exitCode}, ${ago} ago)`);
    }
    for (const url of p.urls) {
      lines.push(`         ${url}`);
    }
  }
  return { output: lines.join('\n') };
};
