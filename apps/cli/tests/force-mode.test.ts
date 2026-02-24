import { describe, expect, test } from 'bun:test';
import {
  confirm,
  setConfirmHandler,
  withForceMode,
} from '../src/tools/confirm.js';

describe('force mode', () => {
  test('withForceMode bypasses handler', async () => {
    setConfirmHandler(async () => false);
    const result = await withForceMode(() => confirm('delete everything'));
    expect(result).toBe(true);
  });

  test('confirm outside withForceMode uses handler normally', async () => {
    setConfirmHandler(async () => false);
    expect(await confirm('delete everything')).toBe(false);
  });

  test('withForceMode returns true for any action', async () => {
    setConfirmHandler(async () => false);
    await withForceMode(async () => {
      expect(await confirm('rm -rf /')).toBe(true);
      expect(await confirm('drop database')).toBe(true);
      expect(await confirm('overwrite file')).toBe(true);
    });
  });

  test('withForceMode does not leak to outer context', async () => {
    setConfirmHandler(async () => false);
    await withForceMode(() => confirm('inner'));
    expect(await confirm('outer')).toBe(false);
  });
});
