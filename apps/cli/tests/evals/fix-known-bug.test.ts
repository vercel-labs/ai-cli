/**
 * Eval: Fix a known bug in an existing project.
 *
 * Pre-seeds a project with a deliberate bug in the divide function
 * (uses multiplication instead of division). Asks the agent to find
 * and fix it. Verifies the fix is correct and tests pass.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/fix-known-bug.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type EvalResult,
  assertCommandSucceeds,
  assertFileContains,
  cleanupWorkDir,
  createWorkDir,
  runEval,
} from './eval-helpers';

const TIMEOUT = 600_000;
const CLI_TIMEOUT = 300;

let workDir: string | null = null;

afterEach(() => {
  if (workDir) {
    cleanupWorkDir(workDir);
    workDir = null;
  }
});

describe('eval: fix a known bug', () => {
  test(
    'finds and fixes the buggy divide function, tests pass',
    async () => {
      workDir = createWorkDir();

      const result: EvalResult = await runEval(
        "There's a bug in this project. The divide function returns wrong results. Find and fix it. Make sure the tests pass.",
        {
          cwd: workDir,
          timeoutSec: CLI_TIMEOUT,
          setup: async (dir: string) => {
            writeFileSync(
              join(dir, 'package.json'),
              JSON.stringify(
                {
                  name: 'math-lib',
                  version: '1.0.0',
                  type: 'module',
                  scripts: { test: 'vitest run' },
                  devDependencies: { vitest: 'latest', typescript: 'latest' },
                },
                null,
                2,
              ),
            );

            writeFileSync(
              join(dir, 'tsconfig.json'),
              JSON.stringify(
                {
                  compilerOptions: {
                    target: 'ES2022',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    strict: true,
                    outDir: 'dist',
                  },
                  include: ['src'],
                },
                null,
                2,
              ),
            );

            mkdirSync(join(dir, 'src'), { recursive: true });

            writeFileSync(
              join(dir, 'src', 'math.ts'),
              [
                'export function add(a: number, b: number): number {',
                '  return a + b;',
                '}',
                '',
                'export function subtract(a: number, b: number): number {',
                '  return a - b;',
                '}',
                '',
                'export function multiply(a: number, b: number): number {',
                '  return a * b;',
                '}',
                '',
                'export function divide(a: number, b: number): number {',
                '  return a * b;',
                '}',
                '',
              ].join('\n'),
            );

            writeFileSync(
              join(dir, 'src', 'math.test.ts'),
              [
                "import { describe, expect, test } from 'vitest';",
                "import { add, subtract, multiply, divide } from './math';",
                '',
                "describe('math', () => {",
                "  test('add', () => {",
                '    expect(add(2, 3)).toBe(5);',
                '  });',
                '',
                "  test('subtract', () => {",
                '    expect(subtract(5, 3)).toBe(2);',
                '  });',
                '',
                "  test('multiply', () => {",
                '    expect(multiply(4, 3)).toBe(12);',
                '  });',
                '',
                "  test('divide', () => {",
                '    expect(divide(10, 2)).toBe(5);',
                '  });',
                '',
                "  test('divide by 1', () => {",
                '    expect(divide(7, 1)).toBe(7);',
                '  });',
                '});',
                '',
              ].join('\n'),
            );

            execSync('npm install', { cwd: dir, stdio: 'pipe' });
          },
        },
      );

      // 1. The buggy `a * b` in divide is gone
      assertFileContains(workDir, 'src/math.ts', /divide[\s\S]*?a\s*\/\s*b/);

      // 2. Tests pass
      assertCommandSucceeds(workDir, 'npm test');

      // 3. Agent completed successfully
      expect(result.json.exitCode).toBe(0);

      console.log(
        `\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});
