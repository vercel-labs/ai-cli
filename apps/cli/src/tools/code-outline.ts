import * as fs from "node:fs";
import * as path from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { resolveAnyPath, safePath } from "../utils/safe-path.js";
import { confirm } from "./confirm.js";

interface Symbol {
	name: string;
	kind: string;
	line: number;
}

/* ── Language-specific regex extractors ───────────────────── */

const TS_JS_PATTERNS: { kind: string; re: RegExp }[] = [
	{
		kind: "function",
		re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
	},
	{
		kind: "const",
		re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/,
	},
	{
		kind: "class",
		re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
	},
	{
		kind: "interface",
		re: /^(?:export\s+)?(?:interface|type)\s+(\w+)/,
	},
	{
		kind: "enum",
		re: /^(?:export\s+)?enum\s+(\w+)/,
	},
	{
		kind: "export",
		re: /^export\s+default\s+(?:function|class|abstract\s+class)\s+(\w+)/,
	},
	{
		kind: "export-default",
		re: /^export\s+default\s+(\w+)/,
	},
];

const PYTHON_PATTERNS: { kind: string; re: RegExp }[] = [
	{
		kind: "class",
		re: /^class\s+(\w+)/,
	},
	{
		kind: "function",
		re: /^(?:async\s+)?def\s+(\w+)/,
	},
	{
		kind: "variable",
		re: /^(\w+)\s*(?::\s*\w+)?\s*=/,
	},
];

const GO_PATTERNS: { kind: string; re: RegExp }[] = [
	{
		kind: "function",
		re: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
	},
	{
		kind: "type",
		re: /^type\s+(\w+)\s+(?:struct|interface)/,
	},
	{
		kind: "const",
		re: /^(?:const|var)\s+(\w+)/,
	},
];

const RUST_PATTERNS: { kind: string; re: RegExp }[] = [
	{
		kind: "function",
		re: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
	},
	{
		kind: "struct",
		re: /^(?:pub\s+)?struct\s+(\w+)/,
	},
	{
		kind: "enum",
		re: /^(?:pub\s+)?enum\s+(\w+)/,
	},
	{
		kind: "trait",
		re: /^(?:pub\s+)?trait\s+(\w+)/,
	},
	{
		kind: "impl",
		re: /^impl(?:<[^>]+>)?\s+(\w+)/,
	},
];

function getPatternsForFile(
	filePath: string,
): { kind: string; re: RegExp }[] | null {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case ".ts":
		case ".tsx":
		case ".js":
		case ".jsx":
		case ".mts":
		case ".mjs":
		case ".cts":
		case ".cjs": {
			return TS_JS_PATTERNS;
		}
		case ".py": {
			return PYTHON_PATTERNS;
		}
		case ".go": {
			return GO_PATTERNS;
		}
		case ".rs": {
			return RUST_PATTERNS;
		}
		default: {
			return null;
		}
	}
}

function extractSymbols(filePath: string, content: string): Symbol[] {
	const patterns = getPatternsForFile(filePath);
	if (!patterns) {
		return [];
	}

	const symbols: Symbol[] = [];
	const seen = new Set<string>();
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trimStart();
		// Skip comments
		if (line.startsWith("//") || line.startsWith("#") || line.startsWith("*")) {
			continue;
		}

		for (const { kind, re } of patterns) {
			const m = line.match(re);
			if (m?.[1]) {
				const key = `${kind}:${m[1]}`;
				if (!seen.has(key)) {
					seen.add(key);
					symbols.push({ name: m[1], kind, line: i + 1 });
				}
				break;
			}
		}
	}

	return symbols;
}

function formatSymbols(filePath: string, symbols: Symbol[]): string {
	if (symbols.length === 0) {
		return `${filePath}: no symbols found`;
	}
	const lines = symbols.map((s) => `  ${s.kind} ${s.name} (line ${s.line})`);
	return `${filePath}:\n${lines.join("\n")}`;
}

/* ── tool ─────────────────────────────────────────────────── */

export const codeOutline = tool({
	description:
		"Get an outline of code symbols (functions, classes, exports, types) from a file or all supported files in a directory. Use this to understand code structure without reading entire files.",
	inputSchema: z.object({
		filePath: z
			.string()
			.describe(
				"File or directory path. For directories, outlines all supported files.",
			),
		maxFiles: z
			.number()
			.optional()
			.describe("Max files to outline in a directory (default 20)"),
	}),
	execute: async ({ filePath, maxFiles = 20 }) => {
		try {
			let fullPath = safePath(filePath);
			if (!fullPath) {
				const allowed = await confirm(
					`outline code outside project: ${filePath}`,
					{ tool: "codeOutline", noAlways: true },
				);
				if (!allowed) {
					return { error: "User denied access to path outside project." };
				}
				fullPath = resolveAnyPath(filePath);
			}

			if (!fs.existsSync(fullPath)) {
				return { error: `not found: ${filePath}` };
			}

			const stat = fs.statSync(fullPath);

			if (stat.isFile()) {
				const content = fs.readFileSync(fullPath, "utf8");
				const symbols = extractSymbols(fullPath, content);
				const output = formatSymbols(
					path.relative(process.cwd(), fullPath) || filePath,
					symbols,
				);
				return { outline: output, symbols };
			}

			// Directory mode — outline all supported files
			const results: string[] = [];
			let fileCount = 0;

			function walkDir(dir: string): void {
				if (fileCount >= maxFiles) {
					return;
				}
				const SKIP = new Set([
					"node_modules",
					".git",
					"dist",
					"build",
					".next",
					"coverage",
				]);
				let entries: fs.Dirent[];
				try {
					entries = fs.readdirSync(dir, { withFileTypes: true });
				} catch {
					return;
				}
				for (const e of entries) {
					if (fileCount >= maxFiles) {
						return;
					}
					if (e.name.startsWith(".") || SKIP.has(e.name)) {
						continue;
					}
					const full = path.join(dir, e.name);
					if (e.isDirectory()) {
						walkDir(full);
					} else if (e.isFile() && getPatternsForFile(full)) {
						try {
							const content = fs.readFileSync(full, "utf8");
							const symbols = extractSymbols(full, content);
							if (symbols.length > 0) {
								results.push(
									formatSymbols(path.relative(process.cwd(), full), symbols),
								);
							}
							fileCount++;
						} catch {}
					}
				}
			}

			walkDir(fullPath);

			if (results.length === 0) {
				return { outline: "No symbols found", symbols: [] };
			}

			return {
				outline: results.join("\n\n"),
				filesScanned: fileCount,
			};
		} catch {
			return { error: `outline failed: ${filePath}` };
		}
	},
});
