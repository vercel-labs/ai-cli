import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_DIR, ensureBaseDir } from '../config/paths.js';
import { logError } from './errorlog.js';

const INDEXES_DIR = path.join(BASE_DIR, 'indexes');

export interface Chunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
}

export interface ProjectIndex {
  /** Hash of the project path for identification */
  projectHash: string;
  /** Absolute path to the project */
  projectPath: string;
  /** File modification times at indexing time */
  fileMtimes: Record<string, number>;
  /** All embedded chunks */
  chunks: Chunk[];
}

function indexPath(projectHash: string): string {
  return path.join(INDEXES_DIR, `${projectHash}.json`);
}

function hashProject(projectPath: string): string {
  return crypto
    .createHash('sha256')
    .update(projectPath)
    .digest('hex')
    .slice(0, 16);
}

export function getProjectHash(projectPath?: string): string {
  return hashProject(projectPath || process.cwd());
}

export function loadIndex(projectPath?: string): ProjectIndex | null {
  const hash = getProjectHash(projectPath);
  const file = indexPath(hash);
  try {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as ProjectIndex;
    return data;
  } catch (e) {
    logError(e);
    return null;
  }
}

export function saveIndex(index: ProjectIndex): void {
  ensureBaseDir();
  if (!fs.existsSync(INDEXES_DIR)) {
    fs.mkdirSync(INDEXES_DIR, { recursive: true });
  }
  const file = indexPath(index.projectHash);
  fs.writeFileSync(file, JSON.stringify(index), 'utf-8');
}

/**
 * Determine which files need (re-)indexing by comparing mtimes.
 */
export function getStaleFiles(
  allFiles: string[],
  index: ProjectIndex | null,
  baseDir: string,
): string[] {
  if (!index) return allFiles;

  const stale: string[] = [];
  for (const f of allFiles) {
    const fullPath = path.resolve(baseDir, f);
    try {
      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;
      if (!index.fileMtimes[f] || index.fileMtimes[f] !== mtime) {
        stale.push(f);
      }
    } catch {
      stale.push(f);
    }
  }
  return stale;
}

/**
 * Split file content into chunks for embedding.
 * Uses a simple line-based chunking strategy.
 */
const CHUNK_SIZE = 40; // lines per chunk
const CHUNK_OVERLAP = 5; // overlap lines

export function chunkFile(
  file: string,
  content: string,
): Array<{ file: string; startLine: number; endLine: number; text: string }> {
  const lines = content.split('\n');
  if (lines.length <= CHUNK_SIZE) {
    return [
      {
        file,
        startLine: 1,
        endLine: lines.length,
        text: content.slice(0, 2000), // cap text size for embedding
      },
    ];
  }

  const chunks: Array<{
    file: string;
    startLine: number;
    endLine: number;
    text: string;
  }> = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(i + CHUNK_SIZE, lines.length);
    const chunkLines = lines.slice(i, end);
    chunks.push({
      file,
      startLine: i + 1,
      endLine: end,
      text: `${file}:${i + 1}-${end}\n${chunkLines.join('\n').slice(0, 2000)}`,
    });
    if (end >= lines.length) break;
  }

  return chunks;
}
