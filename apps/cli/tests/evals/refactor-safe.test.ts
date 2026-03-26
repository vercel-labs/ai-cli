/**
 * Eval: Refactor with test preservation.
 *
 * Pre-seeds a project with a monolithic utils.ts and passing tests.
 * Asks the agent to split utils.ts into separate files per function.
 * Verifies the refactor happened and tests still pass.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/refactor-safe.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	assertCommandSucceeds,
	cleanupWorkDir,
	createWorkDir,
	runEval,
} from "./eval-helpers";
import type { EvalResult } from "./eval-helpers";

const TIMEOUT = 600_000;
const CLI_TIMEOUT = 300;

let workDir: string | null = null;

afterEach(() => {
	if (workDir) {
		cleanupWorkDir(workDir);
		workDir = null;
	}
});

describe("eval: safe refactor", () => {
	test(
		"splits utils.ts into separate files without breaking tests",
		async () => {
			workDir = createWorkDir();

			const result: EvalResult = await runEval(
				"Refactor the utils module. Split the single utils.ts file into separate files (one per function: capitalize.ts, slugify.ts, truncate.ts). Update all imports in index.ts and the test file. Make sure the tests still pass.",
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
					setup: async (dir: string) => {
						writeFileSync(
							join(dir, "package.json"),
							JSON.stringify(
								{
									name: "utils-lib",
									version: "1.0.0",
									type: "module",
									scripts: { test: "vitest run" },
									devDependencies: { vitest: "latest", typescript: "latest" },
								},
								null,
								2,
							),
						);

						writeFileSync(
							join(dir, "tsconfig.json"),
							JSON.stringify(
								{
									compilerOptions: {
										target: "ES2022",
										module: "ESNext",
										moduleResolution: "bundler",
										strict: true,
										outDir: "dist",
									},
									include: ["src"],
								},
								null,
								2,
							),
						);

						mkdirSync(join(dir, "src"), { recursive: true });

						writeFileSync(
							join(dir, "src", "utils.ts"),
							[
								"export function capitalize(str: string): string {",
								"  if (!str) return str;",
								"  return str.charAt(0).toUpperCase() + str.slice(1);",
								"}",
								"",
								"export function slugify(str: string): string {",
								"  return str",
								"    .toLowerCase()",
								"    .trim()",
								"    .replace(/[^\\w\\s-]/g, '')",
								"    .replace(/[\\s_]+/g, '-')",
								"    .replace(/-+/g, '-');",
								"}",
								"",
								"export function truncate(str: string, maxLength: number): string {",
								"  if (str.length <= maxLength) return str;",
								"  return str.slice(0, maxLength - 3) + '...';",
								"}",
								"",
							].join("\n"),
						);

						writeFileSync(
							join(dir, "src", "index.ts"),
							[
								"export { capitalize, slugify, truncate } from './utils';",
								"",
							].join("\n"),
						);

						writeFileSync(
							join(dir, "src", "utils.test.ts"),
							[
								"import { describe, expect, test } from 'vitest';",
								"import { capitalize, slugify, truncate } from './utils';",
								"",
								"describe('capitalize', () => {",
								"  test('capitalizes first letter', () => {",
								"    expect(capitalize('hello')).toBe('Hello');",
								"  });",
								"",
								"  test('handles empty string', () => {",
								"    expect(capitalize('')).toBe('');",
								"  });",
								"});",
								"",
								"describe('slugify', () => {",
								"  test('converts to slug', () => {",
								"    expect(slugify('Hello World')).toBe('hello-world');",
								"  });",
								"",
								"  test('removes special characters', () => {",
								"    expect(slugify('Hello! World?')).toBe('hello-world');",
								"  });",
								"});",
								"",
								"describe('truncate', () => {",
								"  test('truncates long strings', () => {",
								"    expect(truncate('Hello World', 8)).toBe('Hello...');",
								"  });",
								"",
								"  test('keeps short strings', () => {",
								"    expect(truncate('Hi', 10)).toBe('Hi');",
								"  });",
								"});",
								"",
							].join("\n"),
						);

						execSync("npm install", { cwd: dir, stdio: "pipe" });
					},
				},
			);

			// 1. Original monolithic utils.ts should be gone or split
			const monolithGone = !existsSync(join(workDir, "src", "utils.ts"));
			const hasSeparateFiles =
				existsSync(join(workDir, "src", "capitalize.ts")) ||
				existsSync(join(workDir, "src", "slugify.ts")) ||
				existsSync(join(workDir, "src", "truncate.ts"));
			expect(monolithGone || hasSeparateFiles).toBe(true);

			// 2. At least some separate files were created
			expect(hasSeparateFiles).toBe(true);

			// 3. Tests still pass after refactor
			assertCommandSucceeds(workDir, "npm test");

			// 4. Agent completed successfully
			expect(result.json.exitCode).toBe(0);

			console.log(
				`\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
			);
		},
		TIMEOUT,
	);
});
