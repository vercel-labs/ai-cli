import { dim } from "./color.js";

let enabled = false;
let start = Date.now();

export function toggle(): boolean {
	enabled = !enabled;
	start = Date.now();
	return enabled;
}

export function isEnabled(): boolean {
	return enabled;
}

export function log(msg: string): void {
	if (!enabled) {
		return;
	}
	const elapsed = ((Date.now() - start) / 1000).toFixed(2);
	process.stdout.write(`${dim(`[${elapsed}s] ${msg}`)}\n`);
}
