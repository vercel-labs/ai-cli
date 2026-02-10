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

function searchDir(
  dir: string,
  baseDir: string,
  pattern: RegExp,
  results: Array<{ file: string; line: number; content: string }>,
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

    if (entry.isDirectory()) {
      searchDir(fullPath, baseDir, pattern, results, maxResults);
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (pattern.test(lines[i])) {
            results.push({
              file: path.relative(baseDir, fullPath),
              line: i + 1,
              content: lines[i].trim().slice(0, 100),
            });
          }
        }
      } catch {}
    }
  }
}

export const searchInFiles = tool({
  description: 'Search for text or patterns across files.',
  inputSchema: z.object({
    query: z.string().describe('Text or regex pattern to search for'),
    directory: z
      .string()
      .optional()
      .describe('Absolute or relative directory to search in'),
  }),
  execute: async ({ query, directory }) => {
    try {
      const baseDir = path.resolve(directory || '.');
      const pattern = new RegExp(query, 'i');
      const results: Array<{ file: string; line: number; content: string }> =
        [];
      searchDir(baseDir, baseDir, pattern, results, 50);

      if (results.length === 0) {
        return { matches: [], message: 'No matches found' };
      }

      return { matches: results, total: results.length };
    } catch {
      return { error: `search failed: ${query}` };
    }
  },
});
