import { describe, expect, test } from 'bun:test';
import { confirm, setConfirmHandler } from '../src/tools/confirm.js';

describe('confirm', () => {
  test('returns true by default (no handler)', async () => {
    // Reset handler by setting to one that always returns true
    setConfirmHandler(async () => true);
    expect(await confirm('test action')).toBe(true);
  });

  test('uses custom handler when set', async () => {
    setConfirmHandler(async (_action: string) => false);
    expect(await confirm('delete file?')).toBe(false);
  });

  test('passes action string to handler', async () => {
    let received = '';
    setConfirmHandler(async (action: string) => {
      received = action;
      return true;
    });
    await confirm('run: rm -rf /');
    expect(received).toBe('run: rm -rf /');
  });
});
