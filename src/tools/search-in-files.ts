import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { pathError, safePath } from '../utils/safe-path.js';

type Match = { file: string; line: number; content: string };

/* ── ripgrep backend ─────────────────────────────────────── */

function rgAvailable(): boolean {
  try {
    execSync('rg --version', { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

let _hasRg: boolean | null = null;
function hasRg(): boolean {
  if (_hasRg === null) _hasRg = rgAvailable();
  return _hasRg;
}

function searchWithRg(
  query: string,
  baseDir: string,
  max: number,
): Match[] | null {
  if (!hasRg()) return null;
  try {
    // -n = line numbers, -i = case-insensitive, --no-heading, -M = max line length
    const out = execFileSync(
      'rg',
      [
        '-n',
        '-i',
        '-F',
        '--no-heading',
        '-M',
        '200',
        '--max-count',
        String(max),
        '--',
        query,
      ],
      {
        cwd: baseDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024,
      },
    );
    const results: Match[] = [];
    for (const line of out.split('\n')) {
      if (!line || results.length >= max) break;
      // Format: file:line:content
      const m = line.match(/^(.+?):(\d+):(.*)$/);
      if (m) {
        results.push({
          file: m[1],
          line: Number.parseInt(m[2], 10),
          content: m[3].trim().slice(0, 100),
        });
      }
    }
    return results;
  } catch (e: unknown) {
    // rg exits 1 when no matches — that's not an error
    if (e && typeof e === 'object' && 'status' in e && e.status === 1) {
      return [];
    }
    return null; // fall back to Node
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

function searchDirNode(
  dir: string,
  baseDir: string,
  pattern: RegExp,
  results: Match[],
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
      searchDirNode(fullPath, baseDir, pattern, results, maxResults);
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

/* ── tool ─────────────────────────────────────────────────── */

export const searchInFiles = tool({
  description:
    'Search for text or patterns across files. Use this to find code by content (e.g. function names, imports, strings). Preferred over listDirectory for locating code.',
  inputSchema: z.object({
    query: z.string().describe('Text or regex pattern to search for'),
    directory: z
      .string()
      .optional()
      .describe('Absolute or relative directory to search in'),
  }),
  execute: async ({ query, directory }) => {
    try {
      const baseDir = safePath(directory || '.');
      if (!baseDir) return { error: pathError(directory || '.') };
      const max = 50;

      // Try ripgrep first
      const rgResults = searchWithRg(query, baseDir, max);
      if (rgResults !== null) {
        if (rgResults.length === 0) {
          return { matches: [], message: 'No matches found' };
        }
        return { matches: rgResults, total: rgResults.length };
      }

      // Fallback to Node.js walker
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      const results: Match[] = [];
      searchDirNode(baseDir, baseDir, pattern, results, max);

      if (results.length === 0) {
        return { matches: [], message: 'No matches found' };
      }

      return { matches: results, total: results.length };
    } catch {
      return { error: `search failed: ${query}` };
    }
  },
});
