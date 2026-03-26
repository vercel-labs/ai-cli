import * as fs from "node:fs";
import * as path from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { resolveAnyPath, safePath } from "../utils/safe-path.js";
import { confirm } from "./confirm.js";

function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const fileInfo = tool({
	description:
		"Get information about a file or directory (size, modified date, type).",
	inputSchema: z.object({
		filePath: z.string().describe("Absolute or relative path"),
	}),
	execute: async ({ filePath }) => {
		try {
			let fullPath = safePath(filePath);
			if (!fullPath) {
				const allowed = await confirm(
					`get info for path outside project: ${filePath}`,
					{ tool: "fileInfo", noAlways: true },
				);
				if (!allowed) {
					return { error: "User denied access to path outside project." };
				}
				fullPath = resolveAnyPath(filePath);
			}

			if (!fs.existsSync(fullPath)) {
				return { error: `not found: ${filePath}` };
			}

			const stats = fs.statSync(fullPath);
			const ext = path.extname(filePath).slice(1) || "none";

			return {
				path: filePath,
				type: stats.isDirectory() ? "directory" : "file",
				size: formatSize(stats.size),
				sizeBytes: stats.size,
				extension: stats.isDirectory() ? null : ext,
				modified: stats.mtime.toISOString(),
				created: stats.birthtime.toISOString(),
			};
		} catch {
			return { error: `info failed: ${filePath}` };
		}
	},
});
