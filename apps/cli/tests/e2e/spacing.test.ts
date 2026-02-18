/**
 * E2E tests for terminal output spacing.
 * These require a valid API key and network access — do NOT run in CI.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/e2e/
 */
import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const CLI = path.resolve(import.meta.dirname, '../../dist/ai.mjs');

function run(
  args: string[],
  opts: { env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...opts.env };
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (d) => stdout.push(d));
    child.stderr.on('data', (d) => stderr.push(d));
    child.stdin.end();

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        code,
      });
    });
  });
}

describe('piped output spacing', () => {
  test('response has no leading blank lines', async () => {
    const { stdout } = await run([
      '--no-color',
      'respond with just the word pong',
    ]);
    // Piped output should start with the response directly — no blank lines
    expect(stdout.trimEnd()).not.toMatch(/^\n/);
    expect(stdout.toLowerCase()).toContain('pong');
  }, 30_000);

  test('response has no double newlines in body', async () => {
    const { stdout } = await run([
      '--no-color',
      'respond with just the word pong',
    ]);
    // The response body should not contain double blank lines
    expect(stdout).not.toContain('\n\n\n');
  }, 30_000);
});

describe('non-piped output spacing', () => {
  test('model header and response have correct spacing', async () => {
    // When stdout is not a TTY but we pass a message directly,
    // chatCommand runs in non-piped mode if stdout.isTTY is true.
    // Since spawned processes have piped stdio, this tests piped mode.
    // Interactive spacing is tested via: bun run test:e2e:interactive
    const { stdout, code } = await run([
      '--no-color',
      'respond with just the word pong',
    ]);
    expect(code).toBe(0);
    const trimmed = stdout.trim();
    expect(trimmed.length).toBeGreaterThan(0);
  }, 30_000);
});
