import { spawn, type ChildProcess } from 'node:child_process';

export interface ManagedProcess {
  pid: number;
  command: string;
  startedAt: number;
  process: ChildProcess;
  logs: string[];
}

const MAX_LOG_LINES = 100;
const processes: Map<number, ManagedProcess> = new Map();

export function startManagedProcess(command: string): ManagedProcess {
  const proc = spawn(command, [], {
    shell: true,
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pid = proc.pid ?? 0;

  const managed: ManagedProcess = {
    pid,
    command,
    startedAt: Date.now(),
    process: proc,
    logs: [],
  };

  const addLog = (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      managed.logs.push(line);
      if (managed.logs.length > MAX_LOG_LINES) {
        managed.logs.shift();
      }
    }
  };

  proc.stdout?.on('data', addLog);
  proc.stderr?.on('data', addLog);

  proc.on('exit', () => {
    processes.delete(managed.pid);
  });

  processes.set(managed.pid, managed);
  return managed;
}

export function getProcesses(): ManagedProcess[] {
  return Array.from(processes.values());
}

export function getProcess(pid: number): ManagedProcess | undefined {
  return processes.get(pid);
}

export function killManagedProcess(pid: number): boolean {
  const managed = processes.get(pid);
  if (!managed) return false;

  managed.process.kill();
  processes.delete(pid);
  return true;
}

export function killAllProcesses(): void {
  for (const managed of processes.values()) {
    managed.process.kill();
  }
  processes.clear();
}

export function getProcessLogs(pid: number, lines = 50): string[] {
  const managed = processes.get(pid);
  if (!managed) return [];
  return managed.logs.slice(-lines);
}

