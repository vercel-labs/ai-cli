import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

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

export const findFiles = tool({
  description: 'Find files by name pattern (supports * and ? wildcards).',
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
      const results: string[] = [];
      findInDir(searchDir, searchDir, pattern, results, 100);

      if (results.length === 0) {
        return { files: [], message: 'No files found', silent: true };
      }

      return { files: results, total: results.length };
    } catch {
      return { error: `find failed: ${pattern}` };
    }
  },
});
