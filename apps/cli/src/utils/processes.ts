import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface ManagedProcess {
	pid: number;
	command: string;
	startedAt: number;
	process: ChildProcess;
	logs: string[];
	urls: string[];
	exitCode: number | null;
	exitedAt: number | null;
}

const MAX_LOG_LINES = 100;
const processes = new Map<number, ManagedProcess>();

export function startManagedProcess(command: string): ManagedProcess {
	const proc = spawn(command, [], {
		shell: true,
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});

	const pid = proc.pid ?? 0;

	const managed: ManagedProcess = {
		pid,
		command,
		startedAt: Date.now(),
		process: proc,
		logs: [],
		urls: [],
		exitCode: null,
		exitedAt: null,
	};

	const addLog = (data: Buffer) => {
		const lines = data.toString().split("\n").filter(Boolean);
		for (const line of lines) {
			managed.logs.push(line);
			if (managed.logs.length > MAX_LOG_LINES) {
				managed.logs.shift();
			}
		}
	};

	proc.stdout?.on("data", addLog);
	proc.stderr?.on("data", addLog);

	proc.on("exit", (code) => {
		managed.exitCode = code ?? 1;
		managed.exitedAt = Date.now();
	});

	processes.set(managed.pid, managed);
	return managed;
}

export function isRunning(proc: ManagedProcess): boolean {
	return proc.exitCode === null;
}

export function getProcesses(): ManagedProcess[] {
	return [...processes.values()];
}

export function getRunningProcesses(): ManagedProcess[] {
	return [...processes.values()].filter(isRunning);
}

export function getProcess(pid: number): ManagedProcess | undefined {
	return processes.get(pid);
}

export function setProcessUrls(pid: number, urls: string[]): void {
	const managed = processes.get(pid);
	if (managed) {
		managed.urls = urls;
	}
}

export function killManagedProcess(pid: number): boolean {
	const managed = processes.get(pid);
	if (!managed) {
		return false;
	}

	managed.process.kill();
	processes.delete(pid);
	return true;
}

export function killAllProcesses(): void {
	for (const managed of processes.values()) {
		if (isRunning(managed)) {
			managed.process.kill();
		}
	}
	processes.clear();
}

export function clearExitedProcesses(): void {
	for (const [pid, managed] of processes.entries()) {
		if (!isRunning(managed)) {
			processes.delete(pid);
		}
	}
}

export function getProcessLogs(pid: number, lines = 50): string[] {
	const managed = processes.get(pid);
	if (!managed) {
		return [];
	}
	return managed.logs.slice(-lines);
}
