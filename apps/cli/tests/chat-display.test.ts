import { describe, expect, test } from 'bun:test';
import {
  trimLeadingBlankLines,
  formatToolOutput,
  getChatDisplay,
  printMessage,
  renderChatDisplay,
  type MessageType,
} from '../src/ui/chat-display.js';

describe('trimLeadingBlankLines', () => {
  test('removes leading blank lines', () => {
    expect(trimLeadingBlankLines('\n\nhello')).toBe('hello');
  });

  test('removes leading CRLF blank lines', () => {
    expect(trimLeadingBlankLines('\r\n\r\nhello')).toBe('hello');
  });

  test('does not remove trailing blank lines', () => {
    expect(trimLeadingBlankLines('hello\n\n')).toBe('hello\n\n');
  });

  test('returns clean string unchanged', () => {
    expect(trimLeadingBlankLines('hello world')).toBe('hello world');
  });

  test('handles empty string', () => {
    expect(trimLeadingBlankLines('')).toBe('');
  });
});

describe('formatToolOutput', () => {
  test('formats command output header', () => {
    const result = formatToolOutput('$ echo hello');
    expect(result).toBe('Ran echo hello');
  });

  test('formats command output with short body', () => {
    const result = formatToolOutput('$ ls\nfoo\nbar');
    expect(result).toBe('Ran ls\n  foo\n  bar');
  });

  test('truncates command output body beyond 5 lines', () => {
    const lines = ['$ cmd', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = formatToolOutput(lines.join('\n'));
    expect(result).toContain('Ran cmd');
    expect(result).toContain('... 2 lines ...');
    expect(result).toContain('  c');
    expect(result).toContain('  g');
  });

  test('formats labeled output', () => {
    const result = formatToolOutput('> Found files\nfoo.ts\nbar.ts');
    expect(result).toBe('Found files\n  foo.ts\n  bar.ts');
  });

  test('formats labeled output with no body', () => {
    expect(formatToolOutput('> Read file')).toBe('Read file');
  });

  test('truncates labeled output beyond 5 lines', () => {
    const lines = ['> Search', '1', '2', '3', '4', '5', '6', '7'];
    const result = formatToolOutput(lines.join('\n'));
    expect(result).toContain('Search');
    expect(result).toContain('... 2 lines ...');
  });

  test('formats plain tool output', () => {
    const result = formatToolOutput('line1\nline2');
    expect(result).toBe('  line1\n  line2');
  });

  test('truncates plain output beyond 5 lines', () => {
    const lines = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const result = formatToolOutput(lines.join('\n'));
    expect(result).toContain('... 3 lines ...');
    expect(result).toContain('  4');
    expect(result).toContain('  8');
  });
});

describe('getChatDisplay', () => {
  test('returns display array when present', () => {
    const display = [
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'hello' },
    ];
    const result = getChatDisplay({
      display,
      messages: [{ role: 'user', content: 'ignored' }],
    });
    expect(result).toBe(display);
  });

  test('falls back to mapped messages when display is empty', () => {
    const result = getChatDisplay({
      display: [],
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    expect(result).toEqual([
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'hello' },
    ]);
  });

  test('falls back to mapped messages when display is undefined', () => {
    const result = getChatDisplay({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result).toEqual([{ type: 'user', content: 'test' }]);
  });
});

function collect(fn: (write: (text: string) => void) => void): string {
  const parts: string[] = [];
  fn((text) => parts.push(text));
  return parts.join('');
}

describe('printMessage', () => {
  test('prints user message with prefix and trailing newline', () => {
    const out = collect((w) =>
      printMessage({ type: 'user', content: 'hello' }, w),
    );
    expect(out).toContain('hello');
    expect(out).toContain('›');
    expect(out.endsWith('\n\n')).toBe(true);
  });

  test('prints assistant message with content', () => {
    const out = collect((w) =>
      printMessage({ type: 'assistant', content: 'world' }, w),
    );
    expect(out).toContain('world');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('prints tool message', () => {
    const out = collect((w) =>
      printMessage({ type: 'tool', content: '$ echo hi' }, w),
    );
    expect(out).toContain('Ran echo hi');
  });

  test('prints error message', () => {
    const out = collect((w) =>
      printMessage({ type: 'error', content: 'bad thing' }, w),
    );
    expect(out).toContain('error');
    expect(out).toContain('bad thing');
  });

  test('prints info message with header and body', () => {
    const out = collect((w) =>
      printMessage({ type: 'info', content: 'header\nbody line' }, w),
    );
    expect(out).toContain('header');
    expect(out).toContain('body line');
  });

  test('respects trailing=false', () => {
    const withTrailing = collect((w) =>
      printMessage({ type: 'user', content: 'hi' }, w, true),
    );
    const without = collect((w) =>
      printMessage({ type: 'user', content: 'hi' }, w, false),
    );
    expect(withTrailing.length).toBeGreaterThan(without.length);
  });
});

describe('renderChatDisplay', () => {
  test('calls addAndPrint for each message', () => {
    const calls: { type: string; content: string }[] = [];
    renderChatDisplay(
      [
        { type: 'user', content: 'hi' },
        { type: 'assistant', content: 'hey' },
      ],
      () => {},
      (type, content) => calls.push({ type, content }),
    );
    expect(calls).toEqual([
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'hey' },
    ]);
  });

  test('adds spacing between non-user non-info messages', () => {
    const written: string[] = [];
    renderChatDisplay(
      [
        { type: 'assistant', content: 'a' },
        { type: 'tool', content: 'b' },
      ],
      (text) => written.push(text),
      () => {},
    );
    expect(written.some((s) => s.includes('\n'))).toBe(true);
  });

  test('adds spacing when transitioning from info to non-info', () => {
    const written: string[] = [];
    renderChatDisplay(
      [
        { type: 'info', content: 'version info' },
        { type: 'user', content: 'hello' },
      ],
      (text) => written.push(text),
      () => {},
    );
    expect(written.some((s) => s.includes('\n'))).toBe(true);
  });

  test('does not add trailing spacing after last message', () => {
    const written: string[] = [];
    renderChatDisplay(
      [
        { type: 'assistant', content: 'a' },
        { type: 'assistant', content: 'b' },
      ],
      (text) => written.push(text),
      () => {},
    );
    const spacingWrites = written.filter((s) => /^\n+$/.test(s));
    expect(spacingWrites.length).toBe(1);
  });
});
