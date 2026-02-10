import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModelMessage } from 'ai';
import { generateText } from 'ai';
import { RULES_FILE } from '../config/paths.js';
import { AI_CLI_HEADERS } from './constants.js';
import { logError } from './errorlog.js';
import { GATEWAY_URL } from './models.js';

interface ContextFile {
  path: string;
  content: string;
  type: string;
}

function loadFile(filePath: string, type: string): ContextFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content) return { path: filePath, content, type };
  } catch (e) {
    logError(e);
  }
  return null;
}

export function loadContextFiles(startDir?: string): ContextFile[] {
  const files: ContextFile[] = [];
  const cwd = startDir || process.cwd();

  const globalAgents = loadFile(RULES_FILE, 'global');
  if (globalAgents) files.push(globalAgents);

  const projectAgents = loadFile(path.join(cwd, 'AGENTS.md'), 'project');
  if (projectAgents) files.push(projectAgents);

  return files;
}

export function buildContextPrompt(files: ContextFile[]): string {
  if (files.length === 0) return '';
  const sections: string[] = [];
  for (const file of files) {
    const label = file.type === 'global' ? 'global-rules' : 'project-rules';
    sections.push(`<${label}>\n${file.content}\n</${label}>`);
  }
  return sections.join('\n\n');
}

/**
 * Build a compact file tree for the current project.
 * Uses `git ls-files` when inside a git repo (fast, respects .gitignore).
 * Falls back to a bounded recursive walk otherwise.
 * Large directories are collapsed into summary lines.
 */
const FILE_CAP = 200;
const DIR_COLLAPSE = 30; // collapse dirs with more files than this

function gitFiles(cwd: string): string[] | null {
  try {
    const out = execSync('git ls-files', {
      cwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function walkFiles(
  dir: string,
  base: string,
  results: string[],
  cap: number,
): void {
  if (results.length >= cap) return;
  const SKIP = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '.cache',
    '__pycache__',
    '.venv',
    'venv',
  ]);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (results.length >= cap) return;
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkFiles(full, base, results, cap);
    } else {
      results.push(path.relative(base, full));
    }
  }
}

function buildFileTree(files: string[], cap: number): string {
  // Group files by top-level directory
  const dirs = new Map<string, string[]>();
  const rootFiles: string[] = [];

  for (const f of files) {
    const sep = f.indexOf('/');
    if (sep === -1) {
      rootFiles.push(f);
    } else {
      const dir = f.slice(0, sep);
      const rest = f.slice(sep + 1);
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)?.push(rest);
    }
  }

  const lines: string[] = [];
  let count = 0;

  // Root files first
  for (const f of rootFiles) {
    if (count >= cap) {
      lines.push(`... and ${files.length - count} more files`);
      return lines.join('\n');
    }
    lines.push(f);
    count++;
  }

  // Then directories
  for (const [dir, children] of [...dirs].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (count >= cap) {
      lines.push(`... and ${files.length - count} more files`);
      return lines.join('\n');
    }
    if (children.length > DIR_COLLAPSE) {
      // Collapse large dirs — show dir name with count
      lines.push(`${dir}/ (${children.length} files)`);
      count += children.length;
    } else {
      for (const child of children) {
        if (count >= cap) {
          lines.push(`... and ${files.length - count} more files`);
          return lines.join('\n');
        }
        lines.push(`${dir}/${child}`);
        count++;
      }
    }
  }

  return lines.join('\n');
}

export function getProjectFiles(cwd?: string): string {
  const dir = cwd || process.cwd();
  const files = gitFiles(dir);
  if (files && files.length > 0) {
    return buildFileTree(files, FILE_CAP);
  }
  // Fallback: walk filesystem
  const walked: string[] = [];
  walkFiles(dir, dir, walked, FILE_CAP * 2);
  if (walked.length === 0) return '';
  return buildFileTree(walked, FILE_CAP);
}

interface ModelInfo {
  id: string;
  context_window?: number;
}

const cachedModelInfo: Map<string, ModelInfo> = new Map();

export async function getContextWindow(modelId: string): Promise<number> {
  if (cachedModelInfo.has(modelId)) {
    return cachedModelInfo.get(modelId)?.context_window || 128000;
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    const { data } = (await res.json()) as { data: ModelInfo[] };
    for (const m of data) {
      cachedModelInfo.set(m.id, m);
    }
    return cachedModelInfo.get(modelId)?.context_window || 128000;
  } catch {
    return 128000;
  }
}

export function shouldCompress(tokens: number, contextWindow: number): boolean {
  return tokens > contextWindow * 0.75;
}

export async function summarizeHistory(
  history: ModelMessage[],
): Promise<string> {
  if (history.length < 2) {
    return '';
  }

  const conversationText = history
    .map((m) => {
      if (m.role === 'user') {
        return `User: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
      }
      if (m.role === 'assistant') {
        const text = Array.isArray(m.content)
          ? m.content
              .filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('')
          : String(m.content);
        return `Assistant: ${text}`;
      }
      if (m.role === 'tool') {
        return `Tool result: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  try {
    const result = await generateText({
      model: 'google/gemini-2.5-flash-lite',
      system: `Summarize this session. Extract and preserve:
- Files read, created, or modified
- Key decisions and their reasoning
- Problems encountered and solutions
- Current state of the work
- Important context for continuing

Output plain text only. No markdown, no ** or ##, no formatting. Use simple dashes for lists. Be thorough but concise.`,
      prompt: conversationText,
      headers: AI_CLI_HEADERS,
    });

    return result.text;
  } catch (e) {
    logError(e);
    return '';
  }
}
