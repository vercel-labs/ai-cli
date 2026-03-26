/**
 * Eval: Multi-file React component library.
 *
 * Verifies the agent can create multiple React components with
 * TypeScript interfaces and test files, and make all tests pass.
 * Multi-file creation triggers the review loop.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/react-component.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	assertAnyFileContains,
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

describe("eval: multi-file React components", () => {
	test(
		"creates Button and Modal components with tests that pass",
		async () => {
			workDir = createWorkDir();

			const result: EvalResult = await runEval(
				"Create a React component library with a Button component and a Modal component. Each component should have its own file, props interface, and test file. Use TypeScript and Vitest for testing. Make sure all tests pass.",
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
					setup: async (dir: string) => {
						writeFileSync(
							join(dir, "package.json"),
							JSON.stringify(
								{
									name: "react-components",
									version: "1.0.0",
									type: "module",
									scripts: { test: "vitest run" },
									dependencies: {},
									devDependencies: {},
								},
								null,
								2,
							),
						);
					},
				},
			);

			// 1. Button component exists
			assertAnyFileContains(workDir, ["tsx"], "Button");

			// 2. Modal component exists
			assertAnyFileContains(workDir, ["tsx"], "Modal");

			// 3. Props interfaces exist
			assertAnyFileContains(workDir, ["tsx", "ts"], "Props");

			// 4. Test files exist with test assertions
			assertAnyFileContains(workDir, ["tsx", "ts"], "expect");

			// 5. Tests pass
			assertCommandSucceeds(workDir, "npm test");

			// 6. Agent completed successfully
			expect(result.json.exitCode).toBe(0);

			console.log(
				`\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
			);
		},
		TIMEOUT,
	);
});
