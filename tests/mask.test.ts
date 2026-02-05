import { describe, expect, test } from 'bun:test';
import { mask } from '../src/utils/mask.js';

describe('mask', () => {
  test('returns plain text unchanged', () => {
    expect(mask('hello world')).toBe('hello world');
  });

  test('masks OpenAI keys', () => {
    const text = 'key: sk-1234567890abcdef';
    const result = mask(text);
    expect(result).toContain('sk-1234');
    expect(result).not.toContain('1234567890abcdef');
  });

  test('masks GitHub tokens', () => {
    const text = 'token: ghp_abcdefghijklmnop';
    const result = mask(text);
    expect(result).toContain('ghp_');
    expect(result).toContain('****');
  });

  test('masks bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const result = mask(text);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  test('masks AWS keys', () => {
    const text = 'aws_key=AKIAIOSFODNN7EXAMPLE';
    const result = mask(text);
    expect(result).toContain('AKIA');
    expect(result).toContain('****');
  });

  test('masks key-value patterns', () => {
    const text = 'API_KEY=mysecretkey123456';
    const result = mask(text);
    expect(result).toContain('API_KEY=');
    expect(result).not.toContain('mysecretkey123456');
  });

  test('masks multiple secrets in one string', () => {
    const text = 'sk-abc123def456ghi789 and ghp_token12345678';
    const result = mask(text);
    expect(result).toContain('****');
    expect(result.match(/\*\*\*\*/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('preserves short values', () => {
    const text = 'short=abc';
    expect(mask(text)).toBe('short=abc');
  });

  test('handles empty string', () => {
    expect(mask('')).toBe('');
  });

  test('masks Vercel keys', () => {
    const text = 'vck_1234567890abcdef';
    const result = mask(text);
    expect(result).toContain('vck_1234');
    expect(result).toContain('****');
  });
});
