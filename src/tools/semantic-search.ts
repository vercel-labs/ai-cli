import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { cosineSimilarity, embed } from '../utils/embeddings.js';
import {
  type Chunk,
  type ProjectIndex,
  chunkFile,
  getProjectHash,
  getStaleFiles,
  loadIndex,
  saveIndex,
} from '../utils/index-store.js';

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.html',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.mdx',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
]);

const MAX_FILE_SIZE = 50000; // skip files larger than 50KB
const BATCH_SIZE = 50; // embed this many chunks at a time

function getCodeFiles(cwd: string): string[] {
  // Try git ls-files first
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out
      .trim()
      .split('\n')
      .filter((f) => {
        if (!f) return false;
        const ext = path.extname(f).toLowerCase();
        return CODE_EXTENSIONS.has(ext);
      });
  } catch {
    return [];
  }
}

async function buildOrUpdateIndex(cwd: string): Promise<ProjectIndex> {
  const allFiles = getCodeFiles(cwd);
  const existing = loadIndex(cwd);
  const stale = getStaleFiles(allFiles, existing, cwd);

  debug(`semantic-search: ${allFiles.length} files, ${stale.length} stale`);

  // Start with existing chunks (minus stale files)
  const staleSet = new Set(stale);
  const existingChunks: Chunk[] = existing
    ? existing.chunks.filter((c) => !staleSet.has(c.file))
    : [];

  // Remove deleted files
  const allFilesSet = new Set(allFiles);
  const validChunks = existingChunks.filter((c) => allFilesSet.has(c.file));

  // Chunk stale files
  const newChunkData: Array<{
    file: string;
    startLine: number;
    endLine: number;
    text: string;
  }> = [];

  for (const f of stale) {
    const fullPath = path.resolve(cwd, f);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      newChunkData.push(...chunkFile(f, content));
    } catch {
      // skip unreadable files
    }
  }

  // Embed new chunks in batches
  const newChunks: Chunk[] = [];
  for (let i = 0; i < newChunkData.length; i += BATCH_SIZE) {
    const batch = newChunkData.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);
    try {
      const embeddings = await embed(texts);
      for (let j = 0; j < batch.length; j++) {
        newChunks.push({
          file: batch[j].file,
          startLine: batch[j].startLine,
          endLine: batch[j].endLine,
          text: batch[j].text,
          embedding: embeddings[j],
        });
      }
    } catch (e) {
      debug(`semantic-search: embedding batch failed: ${e}`);
      // Skip this batch
    }
  }

  // Build file mtimes
  const fileMtimes: Record<string, number> = {};
  for (const f of allFiles) {
    try {
      const stat = fs.statSync(path.resolve(cwd, f));
      fileMtimes[f] = stat.mtimeMs;
    } catch {}
  }

  const index: ProjectIndex = {
    projectHash: getProjectHash(cwd),
    projectPath: cwd,
    fileMtimes,
    chunks: [...validChunks, ...newChunks],
  };

  saveIndex(index);
  return index;
}

export const semanticSearch = tool({
  description:
    'Search the codebase by meaning using semantic similarity. Use when you need to find code by intent rather than exact text (e.g. "authentication logic", "database connection handling"). Indexes the project on first use.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('Natural language description of what you are looking for'),
    topK: z
      .number()
      .optional()
      .describe('Number of results to return (default 10)'),
  }),
  execute: async ({ query, topK = 10 }) => {
    try {
      const clampedTopK = Math.min(Math.max(topK, 1), 100);
      const cwd = process.cwd();

      // Build or update the index
      const index = await buildOrUpdateIndex(cwd);

      if (index.chunks.length === 0) {
        return { results: [], message: 'No indexed code found' };
      }

      // Embed the query
      const [queryEmbedding] = await embed([query]);

      // Rank chunks by cosine similarity
      const scored = index.chunks.map((chunk) => ({
        file: chunk.file,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        preview: chunk.text.slice(0, 200),
      }));

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, clampedTopK);

      // Deduplicate by file (keep best score per file)
      const seenFiles = new Set<string>();
      const deduplicated = top.filter((r) => {
        if (seenFiles.has(`${r.file}:${r.startLine}`)) return false;
        seenFiles.add(`${r.file}:${r.startLine}`);
        return true;
      });

      return {
        results: deduplicated.map((r) => ({
          file: r.file,
          lines: `${r.startLine}-${r.endLine}`,
          score: Math.round(r.score * 1000) / 1000,
          preview: r.preview,
        })),
        total: deduplicated.length,
        indexedChunks: index.chunks.length,
      };
    } catch (e) {
      debug(`semantic-search error: ${e}`);
      return { error: `semantic search failed: ${e}` };
    }
  },
});
