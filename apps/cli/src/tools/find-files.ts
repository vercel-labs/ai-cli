import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { resolveAnyPath, safePath } from "../utils/safe-path.js";
import { confirm } from "./confirm.js";

const FIND_TIMEOUT_MS = 10000;
const FIND_MAX_BUFFER = 1024 * 1024;

/* ── ripgrep --files + grep backend ──────────────────────── */

function rgFilesAvailable(): boolean {
	try {
		execSync("rg --version", { stdio: "pipe", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

let _hasRg: boolean | null = null;
function hasRg(): boolean {
	if (_hasRg === null) {
		_hasRg = rgFilesAvailable();
	}
	return _hasRg;
}

function globToRegex(pattern: string): string {
	let regex = "";
	for (const ch of pattern) {
		if (ch === "*") {
			regex += ".*";
		} else if (ch === "?") {
			regex += ".";
		}
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal brace chars to escape
		else if (".+^${}()|[]\\".includes(ch)) {
			regex += `\\${ch}`;
		} else {
			regex += ch;
		}
	}
	return regex;
}

function findWithRg(
	pattern: string,
	baseDir: string,
	max: number,
): string[] | null {
	if (!hasRg()) {
		return null;
	}
	try {
		const regex = globToRegex(pattern);
		// rg --files lists all files respecting .gitignore
		const out = execFileSync("rg", ["--files"], {
			cwd: baseDir,
			encoding: "utf8",
			timeout: FIND_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
			maxBuffer: FIND_MAX_BUFFER,
		});
		const results: string[] = [];
		for (const line of out.split("\n")) {
			if (!line) {
				continue;
			}
			// Match against basename
			const basename = line.includes("/")
				? (line.split("/").pop() ?? line)
				: line;
			if (new RegExp(`^${regex}$`, "i").test(basename)) {
				results.push(line);
				if (results.length >= max) {
					break;
				}
			}
		}
		return results;
	} catch {
		return null;
	}
}

/* ── Node.js fallback ────────────────────────────────────── */

const IGNORED = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	".cache",
]);

function matchPattern(name: string, pattern: string): boolean {
	const regex = globToRegex(pattern);
	return new RegExp(`^${regex}$`, "i").test(name);
}

function findInDir(
	dir: string,
	baseDir: string,
	pattern: string,
	results: string[],
	maxResults: number,
): void {
	if (results.length >= maxResults) return;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (results.length >= maxResults) return;
		if (entry.name.startsWith(".") || IGNORED.has(entry.name)) {
			continue;
		}

		const fullPath = path.join(dir, entry.name);

		if (matchPattern(entry.name, pattern)) {
			results.push(path.relative(baseDir, fullPath));
		}

		if (entry.isDirectory()) {
			findInDir(fullPath, baseDir, pattern, results, maxResults);
		}
	}
}

/* ── tool ─────────────────────────────────────────────────── */

export const findFiles = tool({
	description:
		"Find files by name pattern (supports * and ? wildcards). Use this to locate files when the project file tree is not enough.",
	inputSchema: z.object({
		pattern: z
			.string()
			.describe('File name pattern (e.g. "*.ts", "test_?.js")'),
		directory: z
			.string()
			.optional()
			.describe("Absolute or relative directory to search in"),
	}),
	execute: async ({ pattern, directory }) => {
		try {
			let searchDir = safePath(directory || ".");
			if (!searchDir) {
				const allowed = await confirm(
					`find files outside project: ${directory || "."}`,
					{ tool: "findFiles", noAlways: true },
				);
				if (!allowed) {
					return { error: "User denied access to directory outside project." };
				}
				searchDir = resolveAnyPath(directory || ".");
			}
			const max = 100;

			// Try ripgrep --files first
			const rgResults = findWithRg(pattern, searchDir, max);
			if (rgResults !== null) {
				if (rgResults.length === 0) {
					return { files: [], message: "No files found", silent: true };
				}
				return { files: rgResults, total: rgResults.length };
			}

			// Fallback to Node.js walker
			const results: string[] = [];
			findInDir(searchDir, searchDir, pattern, results, max);

			if (results.length === 0) {
				return { files: [], message: "No files found", silent: true };
			}

			return { files: results, total: results.length };
		} catch {
			return { error: `find failed: ${pattern}` };
		}
	},
});
