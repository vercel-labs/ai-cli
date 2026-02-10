import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { cleanupTestDir, resetTestDir } from './helpers/mock-paths.js';

import {
  addRule,
  clearRules,
  invalidatePermissionsCache,
  isAllowed,
  listRules,
  removeRule,
} from '../src/utils/permissions.js';

describe('permissions', () => {
  beforeEach(() => {
    resetTestDir();
    invalidatePermissionsCache();
  });

  afterEach(() => {
    clearRules();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  // ── isAllowed ────────────────────────────────────────────

  test('exact directory match allows access', () => {
    addRule('editFile', '/tmp/project');
    expect(isAllowed('editFile', '/tmp/project')).toBe(true);
  });

  test('subdirectory of rule directory allows access', () => {
    addRule('editFile', '/tmp/project');
    expect(isAllowed('editFile', '/tmp/project/src/utils')).toBe(true);
  });

  test('sibling directory with shared prefix is rejected', () => {
    addRule('editFile', '/tmp/project');
    expect(isAllowed('editFile', '/tmp/project-other')).toBe(false);
  });

  test('parent directory is rejected', () => {
    addRule('editFile', '/tmp/project/src');
    expect(isAllowed('editFile', '/tmp/project')).toBe(false);
  });

  test('tool name mismatch is rejected', () => {
    addRule('editFile', '/tmp/project');
    expect(isAllowed('deleteFile', '/tmp/project')).toBe(false);
  });

  test('runCommand requires exact command match', () => {
    addRule('runCommand', '/tmp/project', 'npm test');
    expect(isAllowed('runCommand', '/tmp/project', 'npm test')).toBe(true);
    expect(isAllowed('runCommand', '/tmp/project', 'npm run build')).toBe(
      false,
    );
    expect(isAllowed('runCommand', '/tmp/project')).toBe(false);
  });

  test('no rules means nothing is allowed', () => {
    expect(isAllowed('editFile', '/tmp/project')).toBe(false);
  });

  // ── addRule ──────────────────────────────────────────────

  test('addRule avoids duplicates', () => {
    addRule('editFile', '/tmp/project');
    addRule('editFile', '/tmp/project');
    expect(listRules()).toHaveLength(1);
  });

  // ── listRules ────────────────────────────────────────────

  test('listRules returns all rules', () => {
    addRule('editFile', '/tmp/project');
    addRule('runCommand', '/tmp/project', 'npm test');
    const rules = listRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].tool).toBe('editFile');
    expect(rules[1].tool).toBe('runCommand');
    expect(rules[1].command).toBe('npm test');
  });

  // ── removeRule ───────────────────────────────────────────

  test('removeRule removes by index', () => {
    addRule('editFile', '/tmp/project');
    addRule('writeFile', '/tmp/project');
    expect(removeRule(0)).toBe(true);
    const rules = listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].tool).toBe('writeFile');
  });

  test('removeRule returns false for invalid index', () => {
    expect(removeRule(0)).toBe(false);
    expect(removeRule(-1)).toBe(false);
  });

  // ── clearRules ───────────────────────────────────────────

  test('clearRules removes all rules', () => {
    addRule('editFile', '/tmp/project');
    addRule('writeFile', '/tmp/project');
    clearRules();
    expect(listRules()).toHaveLength(0);
  });
});
