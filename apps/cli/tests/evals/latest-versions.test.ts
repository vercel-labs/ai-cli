/**
 * Eval: Latest package versions.
 *
 * Creates a minimal project, asks the agent to add zod, then verifies
 * the installed version is current — not an outdated version the model
 * hallucinated from training data.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/latest-versions.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertAnyFileExists,
  assertFileContains,
  cleanupWorkDir,
  createWorkDir,
  type EvalResult,
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

function getLatestVersion(pkg: string): string {
  return execSync(`npm view ${pkg} version`, { encoding: 'utf-8' }).trim();
}

function parseInstalledMajor(dir: string, pkg: string): number | null {
  try {
    const raw = readFileSync(join(dir, 'package.json'), 'utf-8');
    const pkgJson = JSON.parse(raw);
    const version: string | undefined =
      pkgJson.dependencies?.[pkg] ?? pkgJson.devDependencies?.[pkg];
    if (!version) return null;
    const match = version.match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

describe('eval: latest package versions', () => {
  test(
    'installs current major version of zod, not an outdated one',
    async () => {
      workDir = createWorkDir();

      const latestVersion = getLatestVersion('zod');
      const latestMajor = Number.parseInt(latestVersion.split('.')[0], 10);

      const result: EvalResult = await runEval(
        'Add zod to this project. Install it properly.',
        {
          cwd: workDir,
          timeoutSec: CLI_TIMEOUT,
          setup: async (dir: string) => {
            writeFileSync(
              join(dir, 'package.json'),
              JSON.stringify(
                { name: 'test-versions', version: '1.0.0', dependencies: {} },
                null,
                2,
              ),
            );
          },
        },
      );

      // 1. zod was added to package.json
      assertFileContains(workDir, 'package.json', '"zod"');

      // 2. Installed major version matches the actual latest major
      const installedMajor = parseInstalledMajor(workDir, 'zod');
      expect(installedMajor).not.toBeNull();
      expect(installedMajor).toBe(latestMajor);

      // 3. A lockfile exists (dependencies were actually installed)
      assertAnyFileExists(workDir, [
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lockb',
        'bun.lock',
      ]);

      // 4. Agent completed without error
      expect(result.json.exitCode).toBe(0);

      console.log(
        `\n  latest zod: ${latestVersion} (major ${latestMajor}) | installed major: ${installedMajor}`,
      );
      console.log(
        `  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});
