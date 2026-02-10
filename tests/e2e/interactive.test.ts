/**
 * Interactive e2e tests using Bun.Terminal + @xterm/headless.
 *
 * These run the CLI in a real PTY and assert on the final rendered
 * terminal state — confirming that erased confirm prompts, spacing,
 * and tool results look correct to the user.
 *
 * Requires: API key configured, CLI built (`bun run build`).
 * Do NOT run in CI at this time.
 *
 *   bun test tests/e2e/interactive.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnedCli, spawnCli } from './pty-helpers';

let cli: SpawnedCli | null = null;

afterEach(() => {
  cli?.kill();
  cli = null;
});

/** Count consecutive blank lines immediately after the line containing `pattern`. */
function blankLinesAfter(screen: string, pattern: string): number {
  const lines = screen.split('\n');
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(pattern)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return -1;
  let count = 0;
  for (let j = idx + 1; j < lines.length && lines[j].trim() === ''; j++) {
    count++;
  }
  return count;
}

// ---------------------------------------------------------------

describe('interactive spacing', () => {
  test('single blank line between prompt and text response', async () => {
    cli = spawnCli();
    await cli.waitFor('type /help');
    cli.write('respond with just the word pong\r');
    await cli.waitFor('pong');
    await new Promise((r) => setTimeout(r, 500));

    const screen = cli.getScreen();
    expect(screen).toContain('pong');
    expect(blankLinesAfter(screen, 'respond with just the word pong')).toBe(1);
  }, 60_000);
});

describe('run confirm erased', () => {
  test('Run: header is erased after acceptance, only Ran remains', async () => {
    cli = spawnCli();
    await cli.waitFor('type /help');
    cli.write('run pwd\r');
    // Wait for the full confirm dialog (options line) before pressing 'y'
    await cli.waitFor('always');
    cli.write('y');
    await cli.waitFor('Ran');
    await new Promise((r) => setTimeout(r, 500));

    const screen = cli.getScreen();
    expect(screen).toContain('Ran');
    expect(screen).not.toContain('Run:');
    expect(blankLinesAfter(screen, 'run pwd')).toBe(1);
  }, 60_000);
});

describe('edit confirm erased', () => {
  test('Edit header is erased after acceptance, only Edited remains', async () => {
    const dir = join(tmpdir(), `ai-cli-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'test.json'), '{"name":"test"}');

    try {
      cli = spawnCli([], { cwd: dir });
      await cli.waitFor('type /help');
      cli.write('change the name field to hello in test.json\r');
      // Wait for the full confirm dialog (options line) before pressing 'y'
      await cli.waitFor('always');
      cli.write('y');
      await cli.waitFor('Edited');
      await new Promise((r) => setTimeout(r, 500));

      const screen = cli.getScreen();
      expect(screen).toContain('Edited');
      expect(screen).not.toContain('Edit test.json?');
      expect(blankLinesAfter(screen, 'change the name')).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
