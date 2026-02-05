import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateText } from 'ai';
import type { ModelMessage } from 'ai';
import { GATEWAY_URL } from './models.js';
import { RULES_FILE } from '../config/paths.js';

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
  } catch {}
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

