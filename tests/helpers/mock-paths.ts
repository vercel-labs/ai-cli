/**
 * Shared mock for src/config/paths.js used by tests that need filesystem isolation.
 * Import this module BEFORE importing any module that depends on paths.js.
 *
 * Since bun runs all test files in the same process, mock.module is global.
 * Using a shared helper ensures a single consistent mock directory.
 */
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const TEST_BASE_DIR = path.join(
  os.tmpdir(),
  `ai-cli-test-${process.pid}`,
);

fs.mkdirSync(TEST_BASE_DIR, { recursive: true });

mock.module('../../src/config/paths.js', () => ({
  BASE_DIR: TEST_BASE_DIR,
  CONFIG_FILE: path.join(TEST_BASE_DIR, 'config.json'),
  CHATS_DIR: path.join(TEST_BASE_DIR, 'chats'),
  MEMORIES_FILE: path.join(TEST_BASE_DIR, 'memories.json'),
  RULES_FILE: path.join(TEST_BASE_DIR, 'AGENTS.md'),
  SKILLS_DIR: path.join(TEST_BASE_DIR, 'skills'),
  MCP_FILE: path.join(TEST_BASE_DIR, 'mcp.json'),
  ensureBaseDir: () => {
    fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  },
  ensureChatsDir: () => {
    fs.mkdirSync(path.join(TEST_BASE_DIR, 'chats'), { recursive: true });
  },
  ensureSkillsDir: () => {
    fs.mkdirSync(path.join(TEST_BASE_DIR, 'skills'), { recursive: true });
  },
}));

export function cleanupTestDir(): void {
  fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
}

export function resetTestDir(): void {
  fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
}
