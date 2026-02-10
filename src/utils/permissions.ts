import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_DIR } from '../config/paths.js';

function permissionsFile(): string {
  return path.join(BASE_DIR, 'permissions.json');
}

export interface Rule {
  tool: string;
  directory: string;
  /** Only for runCommand — the exact command string */
  command?: string;
}

interface PermissionsData {
  rules: Rule[];
}

let cached: PermissionsData | null = null;

function load(): PermissionsData {
  if (cached) return cached;
  try {
    const file = permissionsFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (data && Array.isArray(data.rules)) {
        cached = data as PermissionsData;
        return cached;
      }
    }
  } catch {}
  cached = { rules: [] };
  return cached;
}

function save(data: PermissionsData): void {
  const file = permissionsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  cached = data;
}

/**
 * Check if a tool action is allowed by a persistent rule.
 * For runCommand, `command` must also match exactly.
 */
export function isAllowed(
  tool: string,
  directory: string,
  command?: string,
): boolean {
  const { rules } = load();
  const dir = path.resolve(directory);
  for (const rule of rules) {
    if (rule.tool !== tool) continue;
    // Directory must match or be a child (with path separator boundary)
    const ruleDir = path.resolve(rule.directory);
    if (dir !== ruleDir && !dir.startsWith(ruleDir + path.sep)) continue;
    // For runCommand, command must match exactly
    if (rule.tool === 'runCommand') {
      if (rule.command && rule.command === command) return true;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Add a persistent always-allow rule.
 */
export function addRule(
  tool: string,
  directory: string,
  command?: string,
): void {
  const data = load();
  const dir = path.resolve(directory);
  // Avoid duplicates
  const exists = data.rules.some(
    (r) =>
      r.tool === tool &&
      r.directory === dir &&
      (r.tool === 'runCommand' ? r.command === command : true),
  );
  if (exists) return;

  const rule: Rule = { tool, directory: dir };
  if (command) rule.command = command;
  data.rules.push(rule);
  save(data);
}

/**
 * Remove a rule by index (0-based).
 */
export function removeRule(index: number): boolean {
  const data = load();
  if (index < 0 || index >= data.rules.length) return false;
  data.rules.splice(index, 1);
  save(data);
  return true;
}

/**
 * Remove all rules.
 */
export function clearRules(): void {
  save({ rules: [] });
}

/**
 * Drop the in-memory cache so the next read goes to disk.
 * Useful for tests that wipe the data directory between runs.
 */
export function invalidatePermissionsCache(): void {
  cached = null;
}

/**
 * Return all rules.
 */
export function listRules(): Rule[] {
  return load().rules;
}
