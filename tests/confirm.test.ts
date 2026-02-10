import { beforeEach, describe, expect, test } from 'bun:test';
import { confirm, setConfirmHandler } from '../src/tools/confirm.js';

describe('confirm', () => {
  beforeEach(() => {
    setConfirmHandler(null);
  });

  test('returns true when no handler is set', async () => {
    expect(await confirm('test action')).toBe(true);
  });

  test('returns true when handler approves', async () => {
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
