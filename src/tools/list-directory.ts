import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveAnyPath, safePath } from '../utils/safe-path.js';
import { confirm } from './confirm.js';

function loadGitignore(dir: string): Set<string> {
  const patterns = new Set<string>();
  const gitignorePath = path.join(dir, '.gitignore');

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const clean = trimmed.replace(/^\//, '').replace(/\/$/, '');
          patterns.add(clean);
        }
      }
    }
  } catch {}
  return patterns;
}

function buildTree(
  dirPath: string,
  ignored: Set<string>,
  prefix = '',
  depth = 0,
  maxDepth = 3,
): string[] {
  if (depth >= maxDepth) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = entries
    .filter((e) => !e.name.startsWith('.') && !ignored.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isLast = i === items.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const name = item.isDirectory() ? `${item.name}/` : item.name;
    lines.push(`${prefix}${connector}${name}`);

    if (item.isDirectory()) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      const childPath = path.join(dirPath, item.name);
      lines.push(
        ...buildTree(childPath, ignored, childPrefix, depth + 1, maxDepth),
      );
    }
  }
  return lines;
}

export const listDirectory = tool({
  description:
    'List files and directories as a tree. Only use when the project file tree in the system prompt is insufficient (e.g. a directory was collapsed). Prefer readFile, searchInFiles, or findFiles instead.',
  inputSchema: z.object({
    dirPath: z
      .string()
      .optional()
      .describe('Absolute or relative path, defaults to .'),
    depth: z
      .number()
      .optional()
      .describe('Max depth to recurse (default 3, max 5)'),
  }),
  execute: async ({ dirPath = '.', depth = 3 }) => {
    try {
      let fullPath = safePath(dirPath);
      if (!fullPath) {
        const allowed = await confirm(
          `list directory outside project: ${dirPath}`,
          { tool: 'listDirectory', noAlways: true },
        );
        if (!allowed)
          return { error: 'User denied access to directory outside project.' };
        fullPath = resolveAnyPath(dirPath);
      }
      const ignored = loadGitignore(fullPath);
      const maxDepth = Math.min(depth, 5);
      const lines = buildTree(fullPath, ignored, '', 0, maxDepth);
      const root = path.basename(fullPath) || fullPath;
      const tree = `${root}/\n${lines.join('\n')}`;
      return { tree, path: fullPath };
    } catch {
      return { error: `list failed: ${dirPath}` };
    }
  },
});
