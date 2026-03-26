import * as fs from "node:fs";
import * as path from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { resolveAnyPath, safePath } from "../utils/safe-path.js";
import { confirm } from "./confirm.js";

export const copyFile = tool({
	description: "Copy a file to a new location.",
	inputSchema: z.object({
		sourcePath: z.string().describe("Absolute or relative path to source"),
		destPath: z.string().describe("Absolute or relative path to destination"),
	}),
	execute: async ({ sourcePath, destPath }) => {
		try {
			let fullSourcePath = safePath(sourcePath);
			if (!fullSourcePath) {
				const allowed = await confirm(
					`copy from outside project: ${sourcePath}`,
					{ tool: "copyFile", noAlways: true },
				);
				if (!allowed) {
					return { error: "User denied access to path outside project." };
				}
				fullSourcePath = resolveAnyPath(sourcePath);
			}

			let fullDestPath = safePath(destPath);
			if (!fullDestPath) {
				const allowed = await confirm(`copy to outside project: ${destPath}`, {
					tool: "copyFile",
					noAlways: true,
				});
				if (!allowed) {
					return { error: "User denied access to path outside project." };
				}
				fullDestPath = resolveAnyPath(destPath);
			}

			if (!fs.existsSync(fullSourcePath)) {
				return { error: `not found: ${sourcePath}` };
			}

			const destDir = path.dirname(fullDestPath);
			if (!fs.existsSync(destDir)) {
				fs.mkdirSync(destDir, { recursive: true });
			}

			fs.copyFileSync(fullSourcePath, fullDestPath);
			return { message: `Copied to ${destPath}`, silent: true };
		} catch {
			return { error: `copy failed: ${sourcePath}` };
		}
	},
});
