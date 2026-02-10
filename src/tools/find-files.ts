import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

/* ── ripgrep --files + grep backend ──────────────────────── */

function rgFilesAvailable(): boolean {
  try {
    execSync('rg --version', { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

let _hasRg: boolean | null = null;
function hasRg(): boolean {
  if (_hasRg === null) _hasRg = rgFilesAvailable();
  return _hasRg;
}

function findWithRg(
  pattern: string,
  baseDir: string,
  max: number,
): string[] | null {
  if (!hasRg()) return null;
  try {
    // Convert glob pattern to regex for filtering filenames
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    // rg --files lists all files respecting .gitignore
    const out = execSync('rg --files', {
      cwd: baseDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    const results: string[] = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      // Match against basename
      const basename = line.includes('/')
        ? (line.split('/').pop() ?? line)
        : line;
      if (new RegExp(`^${regex}$`, 'i').test(basename)) {
        results.push(line);
        if (results.length >= max) break;
      }
    }
    return results;
  } catch {
    return null;
  }
}

/* ── Node.js fallback ────────────────────────────────────── */

const IGNORED = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
];

function matchPattern(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`, 'i').test(name);
}

function findInDir(
  dir: string,
  baseDir: string,
  pattern: string,
  results: string[],
  maxResults: number,
): void {
  if (results.length >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.name.startsWith('.') || IGNORED.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (matchPattern(entry.name, pattern)) {
      results.push(path.relative(baseDir, fullPath));
    }

    if (entry.isDirectory()) {
      findInDir(fullPath, baseDir, pattern, results, maxResults);
    }
  }
}

/* ── tool ─────────────────────────────────────────────────── */

export const findFiles = tool({
  description:
    'Find files by name pattern (supports * and ? wildcards). Use this to locate files when the project file tree is not enough.',
  inputSchema: z.object({
    pattern: z
      .string()
      .describe('File name pattern (e.g. "*.ts", "test_?.js")'),
    directory: z
      .string()
      .optional()
      .describe('Absolute or relative directory to search in'),
  }),
  execute: async ({ pattern, directory }) => {
    try {
      const searchDir = path.resolve(directory || '.');
      const max = 100;

      // Try ripgrep --files first
      const rgResults = findWithRg(pattern, searchDir, max);
      if (rgResults !== null) {
        if (rgResults.length === 0) {
          return { files: [], message: 'No files found', silent: true };
        }
        return { files: rgResults, total: rgResults.length };
      }

      // Fallback to Node.js walker
      const results: string[] = [];
      findInDir(searchDir, searchDir, pattern, results, max);

      if (results.length === 0) {
        return { files: [], message: 'No files found', silent: true };
      }

      return { files: results, total: results.length };
    } catch {
      return { error: `find failed: ${pattern}` };
    }
  },
});
