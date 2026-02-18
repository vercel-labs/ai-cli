/**
 * PTY test helpers — spawn the CLI using Bun.Terminal (built-in PTY)
 * and pipe output into a headless xterm emulator for accurate
 * screen-buffer assertions.
 */
import { Terminal } from '@xterm/headless';
import * as path from 'node:path';

const CLI = path.resolve(import.meta.dirname, '../../dist/ai.mjs');

export interface SpawnedCli {
  /** Write raw bytes to the PTY stdin (keypresses, text, etc.) */
  write(s: string): void;

  /**
   * Poll the terminal buffer until a line containing `pattern` appears.
   * Returns the matching line text. Throws on timeout.
   */
  waitFor(pattern: string, timeoutMs?: number): Promise<string>;

  /**
   * Return the full rendered screen as a single string
   * (trimmed lines joined by '\n', trailing empties removed).
   */
  getScreen(): string;

  /** Return a single rendered line (0-indexed), trimmed. */
  getLine(n: number): string;

  /** Kill the PTY process and dispose the terminal. */
  kill(): void;
}

export function spawnCli(
  args: string[] = [],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): SpawnedCli {
  const COLS = 120;
  const ROWS = 40;

  const xterm = new Terminal({
    cols: COLS,
    rows: ROWS,
    allowProposedApi: true,
  });

  const proc = Bun.spawn([process.execPath, CLI, '--no-color', ...args], {
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...opts.env, NO_COLOR: '1', TERM: 'dumb' },
    terminal: {
      cols: COLS,
      rows: ROWS,
      data(_term, data) {
        xterm.write(data);
      },
    },
  });

  function getScreen(): string {
    const buf = xterm.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.join('\n');
  }

  function getLine(n: number): string {
    const line = xterm.buffer.active.getLine(n);
    return line ? line.translateToString(true) : '';
  }

  function waitFor(pattern: string, timeoutMs = 30_000): Promise<string> {
    const start = Date.now();
    return new Promise<string>((resolve, reject) => {
      const check = () => {
        const buf = xterm.buffer.active;
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line) {
            const text = line.translateToString(true);
            if (text.includes(pattern)) {
              resolve(text);
              return;
            }
          }
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `waitFor("${pattern}") timed out after ${timeoutMs}ms.\nScreen:\n${getScreen()}`,
            ),
          );
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  function write(s: string) {
    proc.terminal?.write(s);
  }

  function kill() {
    try {
      proc.kill();
      proc.terminal?.close();
    } catch {}
    xterm.dispose();
  }

  return { write, waitFor, getScreen, getLine, kill };
}
