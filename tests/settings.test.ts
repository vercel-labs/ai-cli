import { describe, expect, test, beforeEach } from 'bun:test';
import {
  getSetting,
  invalidateSettingsCache,
  loadSettings,
} from '../src/config/settings.js';

describe('settings', () => {
  beforeEach(() => {
    invalidateSettingsCache();
  });

  test('loadSettings returns defaults', () => {
    const settings = loadSettings();
    expect(settings.spacing).toBe(1);
    expect(settings.markdown).toBe(true);
    expect(settings.search).toBe('perplexity');
    expect(settings.steps).toBe(10);
  });

  test('getSetting returns individual values', () => {
    expect(getSetting('spacing')).toBe(1);
    expect(getSetting('markdown')).toBe(true);
  });

  test('loadSettings caches result', () => {
    const a = loadSettings();
    const b = loadSettings();
    // Same object reference due to caching
    expect(a).toBe(b);
  });

  test('invalidateSettingsCache forces reload', () => {
    const a = loadSettings();
    invalidateSettingsCache();
    const b = loadSettings();
    // Different object after invalidation
    expect(a).not.toBe(b);
    // But same values
    expect(a.spacing).toBe(b.spacing);
  });
});
