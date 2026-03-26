/**
 * Eval: Create a new Next.js website.
 *
 * Verifies the agent can:
 *   1. Scaffold a Next.js project from scratch
 *   2. Use TypeScript (system prompt default)
 *   3. Use App Router with src/ directory (system prompt preference)
 *   4. Install dependencies
 *   5. Produce a project that builds successfully
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/create-nextjs.eval.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
	assertAnyFileExists,
	assertCommandSucceeds,
	assertFileContains,
	assertFileExists,
	cleanupWorkDir,
	createWorkDir,
	runEval,
} from "./eval-helpers";
import type { EvalResult } from "./eval-helpers";

const TIMEOUT = 600_000; // 10 min test timeout
const CLI_TIMEOUT = 300; // 5 min CLI --timeout

let workDir: string | null = null;

afterEach(() => {
	if (workDir) {
		cleanupWorkDir(workDir);
		workDir = null;
	}
});

/**
 * The agent may create the project directly in workDir or inside a
 * subdirectory (e.g. "my-app/"). Find whichever contains next.config.
 */
function findProjectDir(root: string): string {
	const nextConfigs = ["next.config.ts", "next.config.mjs", "next.config.js"];

	if (nextConfigs.some((f) => existsSync(join(root, f)))) {
		return root;
	}

	try {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const sub = join(root, entry.name);
			if (nextConfigs.some((f) => existsSync(join(sub, f)))) {
				return sub;
			}
		}
	} catch {}

	return root;
}

describe("eval: create Next.js website", () => {
	test(
		"scaffolds project with TypeScript, App Router, src dir, and builds",
		async () => {
			workDir = createWorkDir();

			const result: EvalResult = await runEval(
				"Create a new Next.js website with a landing page. " +
					"Install all dependencies and make sure the project builds.",
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
				},
			);

			const projectDir = findProjectDir(workDir);

			// 1. Next.js config exists
			assertAnyFileExists(projectDir, [
				"next.config.ts",
				"next.config.mjs",
				"next.config.js",
			]);

			// 2. TypeScript — tsconfig.json must exist
			assertFileExists(projectDir, "tsconfig.json");

			// 3. App Router with src directory
			const hasSrcApp = existsSync(join(projectDir, "src", "app"));
			const hasApp = existsSync(join(projectDir, "app"));
			expect(hasSrcApp || hasApp).toBe(true);

			// 4. package.json includes next as a dependency
			assertFileContains(projectDir, "package.json", '"next"');

			// 5. A lockfile exists (dependencies were installed)
			assertAnyFileExists(projectDir, [
				"pnpm-lock.yaml",
				"bun.lockb",
				"bun.lock",
				"yarn.lock",
				"package-lock.json",
			]);

			// 6. Project builds successfully
			assertCommandSucceeds(projectDir, "npx next build");

			// JSON result: agent completed without getting stuck
			expect(result.json.exitCode).toBeLessThanOrEqual(0);

			console.log(
				`\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
			);
		},
		TIMEOUT,
	);
});
