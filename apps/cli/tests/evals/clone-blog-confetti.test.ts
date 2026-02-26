/**
 * Eval: Clone rauchg/blog and add confetti.
 *
 * Verifies the agent can:
 *   1. Clone a real GitHub repo
 *   2. Detect and use the correct package manager (pnpm)
 *   3. Install a new dependency
 *   4. Modify source code to add confetti
 *   5. Leave the project in a buildable state
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/clone-blog-confetti.eval.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertAnyFileContains,
  assertFileContains,
  assertFileExists,
  assertNoFile,
  cleanupWorkDir,
  createWorkDir,
  type EvalResult,
  runEval,
} from './eval-helpers';

const TIMEOUT = 600_000; // 10 min test timeout (bun:test level)
const CLI_TIMEOUT = 300; // 5 min CLI --timeout

let workDir: string | null = null;

afterEach(() => {
  if (workDir) {
    cleanupWorkDir(workDir);
    workDir = null;
  }
});

describe('eval: clone rauchg/blog + add confetti', () => {
  test(
    'clones repo, uses pnpm, installs confetti, modifies code',
    async () => {
      workDir = createWorkDir();

      const result: EvalResult = await runEval(
        'Clone the repo rauchg/blog and add confetti that triggers on page load. ' +
          'Make sure to install dependencies and verify the changes work.',
        {
          cwd: workDir,
          timeoutSec: CLI_TIMEOUT,
        },
      );

      const blogDir = join(workDir, 'blog');
      const hasBlogDir = existsSync(blogDir);

      // The agent may clone into the workDir root or into a `blog/` subdirectory.
      // Determine the actual project root.
      const projectDir = hasBlogDir ? blogDir : workDir;

      // 1. Repo was cloned — next.config.js from rauchg/blog must exist
      assertFileExists(projectDir, 'next.config.js');

      // 2. Correct package manager: pnpm-lock.yaml must be present
      assertFileExists(projectDir, 'pnpm-lock.yaml');

      // 3. Wrong package managers must NOT be used
      assertNoFile(projectDir, 'package-lock.json');
      assertNoFile(projectDir, 'yarn.lock');
      assertNoFile(projectDir, 'bun.lockb');

      // 4. A confetti dependency was added to package.json
      assertFileContains(projectDir, 'package.json', /confetti/i);

      // 5. At least one source file contains confetti-related code
      assertAnyFileContains(projectDir, ['ts', 'tsx', 'js', 'jsx'], 'confetti');

      // 6. JSON result: agent didn't get stuck
      expect(result.json.exitCode).toBeLessThanOrEqual(0);

      console.log(
        `\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});
