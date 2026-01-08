import { dim } from 'yoctocolors';
import {
  getProcesses,
  killManagedProcess,
  type ManagedProcess,
} from '../../utils/processes.js';
import type { CommandHandler } from './types.js';

function formatUptime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

async function selectProcess(
  procs: ManagedProcess[],
): Promise<'exit' | null> {
  if (procs.length === 0) {
    console.log(dim('no background processes\n'));
    return 'exit';
  }

  let selected = 0;
  let lastRenderedCount = 0;

  process.stdout.write('\x1b[?25l');

  const clearLines = (count: number) => {
    for (let i = 0; i < count; i++) {
      process.stdout.write('\x1b[A\x1b[2K');
    }
  };

  const render = (initial = false) => {
    if (!initial && lastRenderedCount > 0) {
      clearLines(lastRenderedCount + 2);
    }

    console.log(dim('background processes (↑↓ navigate, k kill, esc exit):'));
    for (let i = 0; i < procs.length; i++) {
      const p = procs[i];
      const prefix = i === selected ? '› ' : '  ';
      const uptime = formatUptime(p.startedAt);
      const line = `${p.pid} - ${p.command} (${uptime})`;
      console.log(i === selected ? prefix + line : dim(prefix + line));
    }
    console.log();
    lastRenderedCount = procs.length;
  };

  render(true);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let done = false;

    const cleanup = (result: 'exit' | null) => {
      if (done) return;
      done = true;
      stdin.removeListener('data', onKey);
      stdin.setRawMode?.(false);
      process.stdout.write('\x1b[?25h');
      resolve(result);
    };

    const onKey = (key: string) => {
      if (done) return;

      if (key === 'k' || key === 'K') {
        const proc = procs[selected];
        if (proc) {
          killManagedProcess(proc.pid);
          procs = getProcesses();
          if (procs.length === 0) {
            clearLines(lastRenderedCount + 2);
            cleanup('exit');
            return;
          }
          if (selected >= procs.length) selected = Math.max(0, procs.length - 1);
          render();
        }
      } else if (key === '\x1b[A' && selected > 0) {
        selected--;
        render();
      } else if (key === '\x1b[B' && selected < procs.length - 1) {
        selected++;
        render();
      } else if (key === '\x1b' || key === '\x03') {
        clearLines(lastRenderedCount + 2);
        cleanup('exit');
      }
    };

    stdin.on('data', onKey);
  });
}

export const processes: CommandHandler = async (ctx) => {
  ctx.rl.close();
  const procs = getProcesses();
  await selectProcess(procs);
  const newRl = ctx.createRl();
  return { rl: newRl };
};

