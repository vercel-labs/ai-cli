/**
 * Eval: Package manager detection.
 *
 * Pre-populates a temp dir with a package.json and yarn.lock, then asks
 * the agent to install a dependency. Verifies the agent respects the
 * existing lockfile and uses yarn — not npm, pnpm, or bun.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/package-manager.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	assertFileContains,
	assertFileExists,
	assertNoFile,
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

describe("eval: package manager detection", () => {
	test(
		"detects yarn from lockfile and uses it to install a dependency",
		async () => {
			workDir = createWorkDir();

			const result: EvalResult = await runEval(
				"Add the lodash package to this project.",
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
					setup: async (dir: string) => {
						writeFileSync(
							join(dir, "package.json"),
							JSON.stringify(
								{
									name: "test-yarn-project",
									version: "1.0.0",
									dependencies: {},
								},
								null,
								2,
							),
						);
						writeFileSync(join(dir, "yarn.lock"), "# yarn lockfile v1\n");
					},
				},
			);

			// 1. yarn.lock still exists (agent used yarn)
			assertFileExists(workDir, "yarn.lock");

			// 2. No wrong lockfiles created
			assertNoFile(workDir, "package-lock.json");
			assertNoFile(workDir, "pnpm-lock.yaml");
			assertNoFile(workDir, "bun.lockb");
			assertNoFile(workDir, "bun.lock");

			// 3. lodash was added to package.json
			assertFileContains(workDir, "package.json", '"lodash"');

			// 4. Agent completed without getting stuck
			expect(result.json.exitCode).toBe(0);

			console.log(
				`\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
			);
		},
		TIMEOUT,
	);
});
