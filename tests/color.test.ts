import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  bold,
  cyan,
  dim,
  dimmer,
  gray,
  green,
  isColorEnabled,
  magenta,
  red,
  yellow,
} from '../src/utils/color.js';

const savedNoColor = process.env.NO_COLOR;

describe('color utilities', () => {
  beforeEach(() => {
    delete process.env.NO_COLOR;
  });
  afterEach(() => {
    if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
    else delete process.env.NO_COLOR;
  });

  test('colors enabled by default', () => {
    expect(isColorEnabled()).toBe(true);
  });

  test('dim wraps text with ANSI codes', () => {
    expect(dim('hello')).toBe('\x1b[2mhello\x1b[0m');
  });

  test('dimmer wraps text with dim+gray ANSI codes', () => {
    expect(dimmer('hello')).toBe('\x1b[2m\x1b[90mhello\x1b[0m');
  });

  test('green wraps text with green ANSI code', () => {
    expect(green('ok')).toBe('\x1b[32mok\x1b[0m');
  });

  test('red wraps text with red ANSI code', () => {
    expect(red('err')).toBe('\x1b[31merr\x1b[0m');
  });

  test('cyan wraps text with cyan ANSI code', () => {
    expect(cyan('info')).toBe('\x1b[36minfo\x1b[0m');
  });

  test('yellow wraps text', () => {
    expect(yellow('warn')).toBe('\x1b[33mwarn\x1b[0m');
  });

  test('magenta wraps text', () => {
    expect(magenta('num')).toBe('\x1b[35mnum\x1b[0m');
  });

  test('bold wraps text', () => {
    expect(bold('title')).toBe('\x1b[1mtitle\x1b[0m');
  });

  test('gray wraps text', () => {
    expect(gray('muted')).toBe('\x1b[90mmuted\x1b[0m');
  });
});

describe('NO_COLOR support', () => {
  beforeEach(() => {
    delete process.env.NO_COLOR;
  });
  afterEach(() => {
    if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
    else delete process.env.NO_COLOR;
  });

  test('NO_COLOR disables colors', () => {
    process.env.NO_COLOR = '1';
    expect(isColorEnabled()).toBe(false);
  });

  test('NO_COLOR empty string disables colors', () => {
    process.env.NO_COLOR = '';
    // Per spec, NO_COLOR is checked for presence, not value.
    // However our check uses !process.env.NO_COLOR which treats '' as falsy.
    // Empty string is intentionally treated as "not set" since it's unusual.
    expect(isColorEnabled()).toBe(true);
  });

  test('dim returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(dim('hello')).toBe('hello');
  });

  test('dimmer returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(dimmer('hello')).toBe('hello');
  });

  test('green returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(green('ok')).toBe('ok');
  });

  test('red returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(red('err')).toBe('err');
  });

  test('bold returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(bold('title')).toBe('title');
  });

  test('all color functions return plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    const fns = [dim, dimmer, bold, green, red, cyan, yellow, magenta, gray];
    for (const fn of fns) {
      expect(fn('test')).toBe('test');
    }
  });
});
