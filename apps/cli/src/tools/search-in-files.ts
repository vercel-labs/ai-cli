import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { resolveAnyPath, safePath } from "../utils/safe-path.js";
import { confirm } from "./confirm.js";

interface Match {
	file: string;
	line: number;
	content: string;
}

const SEARCH_TIMEOUT_MS = 10000;
const SEARCH_MAX_BUFFER = 1024 * 1024;

/* ── ripgrep backend ─────────────────────────────────────── */

function rgAvailable(): boolean {
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
		_hasRg = rgAvailable();
	}
	return _hasRg;
}

function searchWithRg(
	query: string,
	baseDir: string,
	max: number,
	file?: string,
): Match[] | null {
	if (!hasRg()) {
		return null;
	}
	try {
		// -n = line numbers, -i = case-insensitive, --no-heading, -M = max line length
		const args = [
			"-n",
			"-i",
			"-F",
			"--no-heading",
			"-M",
			"200",
			"--max-count",
			String(max),
			"--",
			query,
		];
		// When a specific file is provided, pass it as a positional argument
		// so rg searches only that file instead of the entire directory.
		if (file) {
			args.push(file);
		}

		const out = execFileSync("rg", args, {
			cwd: baseDir,
			encoding: "utf8",
			timeout: SEARCH_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
			maxBuffer: SEARCH_MAX_BUFFER,
		});
		const results: Match[] = [];
		for (const line of out.split("\n")) {
			if (!line || results.length >= max) {
				break;
			}
			// Format: file:line:content  (or line:content when searching a single file)
			const m = file
				? line.match(/^(\d+):(.*)$/)
				: line.match(/^(.+?):(\d+):(.*)$/);
			if (m) {
				if (file) {
					results.push({
						file,
						line: Number.parseInt(m[1], 10),
						content: m[2].trim().slice(0, 100),
					});
				} else {
					results.push({
						file: m[1],
						line: Number.parseInt(m[2], 10),
						content: m[3].trim().slice(0, 100),
					});
				}
			}
		}
		return results;
	} catch (error: unknown) {
		// rg exits 1 when no matches — that's not an error
		if (
			error &&
			typeof error === "object" &&
			"status" in error &&
			error.status === 1
		) {
			return [];
		}
		return null; // fall back to Node
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

function searchDirNode(
	dir: string,
	baseDir: string,
	pattern: RegExp,
	results: Match[],
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

		if (entry.isDirectory()) {
			searchDirNode(fullPath, baseDir, pattern, results, maxResults);
		} else if (entry.isFile()) {
			try {
				const content = fs.readFileSync(fullPath, "utf8");
				const lines = content.split("\n");
				for (let i = 0; i < lines.length && results.length < maxResults; i++) {
					if (pattern.test(lines[i])) {
						results.push({
							file: path.relative(baseDir, fullPath),
							line: i + 1,
							content: lines[i].trim().slice(0, 100),
						});
					}
				}
			} catch {}
		}
	}
}

function searchFileNode(
	filePath: string,
	baseDir: string,
	pattern: RegExp,
	results: Match[],
	maxResults: number,
): void {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const lines = content.split("\n");
		for (let i = 0; i < lines.length && results.length < maxResults; i++) {
			if (pattern.test(lines[i])) {
				results.push({
					file: path.relative(baseDir, filePath),
					line: i + 1,
					content: lines[i].trim().slice(0, 100),
				});
			}
		}
	} catch {
		// unreadable file — skip
	}
}

/* ── tool ─────────────────────────────────────────────────── */

export const searchInFiles = tool({
	description:
		"Search for text or patterns across files. Use this to find code by content (e.g. function names, imports, strings). Preferred over listDirectory for locating code.",
	inputSchema: z.object({
		query: z.string().describe("Text or regex pattern to search for"),
		directory: z
			.string()
			.optional()
			.describe("Absolute or relative directory to search in"),
	}),
	execute: async ({ query, directory }) => {
		try {
			let baseDir = safePath(directory || ".");
			if (!baseDir) {
				const allowed = await confirm(
					`search files outside project: ${directory || "."}`,
					{ tool: "searchInFiles", noAlways: true },
				);
				if (!allowed) {
					return { error: "User denied access to directory outside project." };
				}
				baseDir = resolveAnyPath(directory || ".");
			}
			const max = 50;

			// If the resolved path is a file rather than a directory, search
			// that single file directly instead of silently returning nothing.
			let singleFile: string | null = null;
			try {
				if (fs.statSync(baseDir).isFile()) {
					singleFile = baseDir;
					baseDir = path.dirname(baseDir);
				}
			} catch {
				// path doesn't exist yet — fall through to normal search
			}

			// Try ripgrep first
			const rgResults = singleFile
				? searchWithRg(query, baseDir, max, path.basename(singleFile))
				: searchWithRg(query, baseDir, max);
			if (rgResults !== null) {
				if (rgResults.length === 0) {
					return { matches: [], message: "No matches found" };
				}
				return { matches: rgResults, total: rgResults.length };
			}

			// Fallback to Node.js walker
			const escaped = query.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const pattern = new RegExp(escaped, "i");
			const results: Match[] = [];

			if (singleFile) {
				searchFileNode(singleFile, baseDir, pattern, results, max);
			} else {
				searchDirNode(baseDir, baseDir, pattern, results, max);
			}

			if (results.length === 0) {
				return { matches: [], message: "No matches found" };
			}

			return { matches: results, total: results.length };
		} catch {
			return { error: `search failed: ${query}` };
		}
	},
});
