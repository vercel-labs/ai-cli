/**
 * Eval: Date awareness.
 *
 * Asks the agent what today's date is and verifies the response
 * contains the correct year, month, and day. This validates that
 * the system prompt's date injection works end-to-end.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/date-awareness.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";

import { cleanupWorkDir, createWorkDir, runEval } from "./eval-helpers";
import type { EvalResult } from "./eval-helpers";

const TIMEOUT = 120_000;
const CLI_TIMEOUT = 60;

let workDir: string | null = null;

afterEach(() => {
	if (workDir) {
		cleanupWorkDir(workDir);
		workDir = null;
	}
});

describe("eval: date awareness", () => {
	test(
		"agent responds with the correct current date",
		async () => {
			workDir = createWorkDir();

			const now = new Date();
			const year = String(now.getFullYear());
			const monthLong = now.toLocaleString("en-US", { month: "long" });
			const monthShort = now.toLocaleString("en-US", { month: "short" });
			const monthNum = String(now.getMonth() + 1);
			const monthPadded = monthNum.padStart(2, "0");
			const day = String(now.getDate());

			const result: EvalResult = await runEval(
				"What is today's date? Respond with just the date.",
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
				},
			);

			const output = result.json.output.toLowerCase();

			// 1. Output contains the correct year
			expect(output).toContain(year);

			// 2. Output contains the correct month (long, short, or numeric)
			const hasMonth =
				output.includes(monthLong.toLowerCase()) ||
				output.includes(monthShort.toLowerCase()) ||
				output.includes(`/${monthPadded}/`) ||
				output.includes(`/${monthNum}/`) ||
				output.includes(`-${monthPadded}-`) ||
				output.includes(`-${monthNum}-`);
			expect(hasMonth).toBe(true);

			// 3. Output contains the correct day of month
			expect(output).toContain(day);

			// 4. Agent completed without error
			expect(result.json.exitCode).toBe(0);

			console.log(`\n  expected: ${monthLong} ${day}, ${year}`);
			console.log(`  output: ${result.json.output.trim()}`);
			console.log(
				`  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
			);
		},
		TIMEOUT,
	);
});
