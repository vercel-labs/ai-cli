import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateText } from 'ai';
import type { ModelMessage } from 'ai';
import { GATEWAY_URL } from './models.js';

const CONTEXT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.cursorrules'];

interface ContextFile {
  path: string;
  content: string;
  type: string;
}

export function loadContextFiles(startDir?: string): ContextFile[] {
  const files: ContextFile[] = [];
  const cwd = startDir || process.cwd();

  for (const filename of CONTEXT_FILES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content) files.push({ path: filePath, content, type: filename });
      } catch {}
    }
  }

  const cursorRulesDir = path.join(cwd, '.cursor', 'rules');
  if (fs.existsSync(cursorRulesDir)) {
    try {
      const entries = fs.readdirSync(cursorRulesDir);
      for (const entry of entries) {
        const entryPath = path.join(cursorRulesDir, entry);
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          const ruleMd = path.join(entryPath, 'RULE.md');
          if (fs.existsSync(ruleMd)) {
            const content = fs.readFileSync(ruleMd, 'utf-8').trim();
            if (content && shouldApplyRule(content, cwd)) {
              files.push({ path: ruleMd, content: stripFrontmatter(content), type: 'cursor-rule' });
            }
          }
        } else if (entry.endsWith('.md') || entry.endsWith('.mdc')) {
          const content = fs.readFileSync(entryPath, 'utf-8').trim();
          if (content && shouldApplyRule(content, cwd)) {
            files.push({ path: entryPath, content: stripFrontmatter(content), type: 'cursor-rule' });
          }
        }
      }
    } catch {}
  }

  const homeClaudeMd = path.join(os.homedir(), 'CLAUDE.md');
  if (fs.existsSync(homeClaudeMd) && homeClaudeMd !== path.join(cwd, 'CLAUDE.md')) {
    try {
      const content = fs.readFileSync(homeClaudeMd, 'utf-8').trim();
      if (content) files.push({ path: homeClaudeMd, content, type: 'global-claude' });
    } catch {}
  }

  return files;
}

interface RuleFrontmatter {
  alwaysApply?: boolean;
  globs?: string[];
  description?: string;
}

function parseFrontmatter(content: string): RuleFrontmatter | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end);
  const result: RuleFrontmatter = {};

  const alwaysMatch = fm.match(/alwaysApply:\s*(true|false)/);
  if (alwaysMatch) result.alwaysApply = alwaysMatch[1] === 'true';

  const globsMatch = fm.match(/globs:\s*\[([^\]]+)\]/);
  if (globsMatch) {
    result.globs = globsMatch[1]
      .split(',')
      .map((g) => g.trim().replace(/["']/g, ''))
      .filter(Boolean);
  }

  const descMatch = fm.match(/description:\s*["']([^"']+)["']/);
  if (descMatch) result.description = descMatch[1];

  return result;
}

function globMatch(pattern: string, filepath: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*');
  return new RegExp(`^${regex}$`).test(filepath);
}

let cachedFiles: string[] | null = null;
let cachedCwd: string | null = null;

function shouldApplyRule(content: string, cwd: string): boolean {
  const fm = parseFrontmatter(content);
  if (!fm) return true;

  if (fm.alwaysApply === true) return true;
  if (fm.alwaysApply === false && (!fm.globs || fm.globs.length === 0)) return true;

  if (fm.globs && fm.globs.length > 0) {
    try {
      if (cachedCwd !== cwd) {
        cachedFiles = listFilesRecursive(cwd, 2);
        cachedCwd = cwd;
      }
      for (const file of cachedFiles || []) {
        const rel = path.relative(cwd, file);
        for (const glob of fm.globs) {
          if (globMatch(glob, rel)) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  return true;
}

function listFilesRecursive(dir: string, depth: number): string[] {
  if (depth <= 0) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile()) results.push(full);
      else if (entry.isDirectory()) results.push(...listFilesRecursive(full, depth - 1));
    }
  } catch {}
  return results;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

export function buildContextPrompt(files: ContextFile[]): string {
  if (files.length === 0) return '';
  const sections: string[] = [];
  for (const file of files) {
    const label = file.type === 'CLAUDE.md' ? 'project-context'
      : file.type === 'CLAUDE.local.md' ? 'local-context'
      : file.type === 'AGENTS.md' ? 'agents-context'
      : file.type === '.cursorrules' ? 'cursor-rules'
      : file.type === 'global-claude' ? 'global-context'
      : 'context';
    sections.push(`<${label}>\n${file.content}\n</${label}>`);
  }
  return sections.join('\n\n');
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
    const res = await fetch(`${GATEWAY_URL}/v1/models`, { signal: AbortSignal.timeout(3000) });
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
      headers: {
        'HTTP-Referer': 'https://www.npmjs.com/package/ai-cli',
        'X-Title': 'ai-cli',
      },
    });

    return result.text;
  } catch {
    return '';
  }
}

