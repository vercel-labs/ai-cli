import { AsyncLocalStorage } from "node:async_hooks";

import { isAllowed } from "../utils/permissions.js";

export interface ConfirmOpts {
	tool?: string;
	command?: string;
	/** When true, the "always" option is hidden from the prompt. */
	noAlways?: boolean;
}

let handler: ((action: string, opts?: ConfirmOpts) => Promise<boolean>) | null =
	null;

const forceStorage = new AsyncLocalStorage<boolean>();

/** Run `fn` with all confirm() calls auto-approved. Scoped to the async context — no global state to clean up. */
export function withForceMode<T>(fn: () => T): T {
	return forceStorage.run(true, fn);
}

// Queue to serialize concurrent confirm() calls so only one prompt
// is visible at a time (the AI SDK fires tool executions in parallel).
let queue: Promise<boolean> = Promise.resolve(true);

export async function confirm(
	action: string,
	opts?: ConfirmOpts,
): Promise<boolean> {
	if (forceStorage.getStore()) {
		return true;
	}

	// Check persistent permissions first
	if (opts?.tool) {
		const cwd = process.cwd();
		if (isAllowed(opts.tool, cwd, opts.command)) {
			return true;
		}
	}

	if (!handler) {
		// Default: allow in non-interactive (piped) mode
		return true;
	}

	// Chain onto the queue so prompts appear one at a time
	const prev = queue;
	let resolve!: (v: boolean) => void;
	queue = new Promise<boolean>((r) => {
		resolve = r;
	});

	// Wait for any previous confirm to finish
	await prev;

	try {
		const result = await handler(action, opts);
		resolve(result);
		return result;
	} catch (error) {
		resolve(false);
		throw error;
	}
}

export function setConfirmHandler(
	fn: ((action: string, opts?: ConfirmOpts) => Promise<boolean>) | null,
): void {
	handler = fn;
}

export function resolveConfirm(_result: boolean): void {
	// kept for compatibility; resolution is handled inside the handler
}
