import { tool } from "ai";
import { z } from "zod";

import { log as debug } from "../utils/debug.js";
import {
	getProcessLogs,
	setProcessUrls,
	startManagedProcess,
} from "../utils/processes.js";

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/gi;

/**
 * Poll process logs for server URLs.
 * Waits up to `maxMs` (default 15 s), checking every 500 ms.
 * Stops early once output has appeared and no new URLs are found for 3 s
 * (servers are likely done starting).
 */
async function collectUrls(
	pid: number,
	maxMs = 15_000,
): Promise<{ urls: string[]; logs: string[] }> {
	const found = new Set<string>();
	let lastNewUrlAt = 0;
	const start = Date.now();

	while (Date.now() - start < maxMs) {
		const logs = getProcessLogs(pid, 100);
		for (const line of logs) {
			const matches = line.match(URL_RE);
			if (matches) {
				for (const m of matches) {
					if (!found.has(m)) {
						found.add(m);
						lastNewUrlAt = Date.now();
					}
				}
			}
		}

		// If we found URLs and haven't seen a new one in 3 s, assume done
		if (found.size > 0 && Date.now() - lastNewUrlAt > 3_000) {
			break;
		}

		await new Promise((r) => setTimeout(r, 500));
	}

	return { urls: [...found], logs: getProcessLogs(pid, 50) };
}

export const startProcess = tool({
	description:
		"Start long-running background process. USE THIS for: dev, start, serve, watch, preview. " +
		"Waits up to 15 s for server URLs to appear. Returns all detected URLs and recent output. " +
		"ALWAYS report every URL back to the user. If no URLs are found, share the recent logs so the user knows what happened.",
	inputSchema: z.object({
		command: z.string().describe("Command to run"),
	}),
	execute: async ({ command: rawCommand }) => {
		const command = rawCommand
			.replaceAll(/&amp;/g, "&")
			.replaceAll(/&lt;/g, "<")
			.replaceAll(/&gt;/g, ">")
			.replaceAll(/&quot;/g, '"')
			.replaceAll(/&#39;/g, "'");
		debug(`startProcess: ${command}`);
		const proc = startManagedProcess(command);

		const { urls, logs } = await collectUrls(proc.pid);

		if (urls.length > 0) {
			setProcessUrls(proc.pid, urls);
		}

		const parts: string[] = [`${command} (pid: ${proc.pid})`];
		if (urls.length > 0) {
			parts.push(`\nServers ready:\n${urls.map((u) => `  ${u}`).join("\n")}`);
		} else if (logs.length > 0) {
			parts.push("\nRecent output:");
			parts.push(logs.slice(-20).join("\n"));
		} else {
			parts.push("\nNo output yet — the process may still be starting.");
		}

		const message = parts.join("");

		return {
			message,
			pid: proc.pid,
			urls,
			logs: logs.slice(-20),
			silent: true,
		};
	},
});
