import { spawnSync } from 'node:child_process';
import { generateText } from 'ai';
import type { CommandHandler } from './types.js';

const ignored = [
  'dist/',
  'node_modules/',
  '.next/',
  'build/',
  '.DS_Store',
  '*.min.js',
  '*.min.css',
];

function shouldIgnore(file: string): boolean {
  for (const pattern of ignored) {
    if (pattern.endsWith('/') && file.startsWith(pattern.slice(0, -1)))
      return true;
    if (pattern.startsWith('*') && file.endsWith(pattern.slice(1))) return true;
    if (file.includes(pattern)) return true;
  }
  return false;
}

async function generateMessage(
  model: string,
  files: string[],
  diffs: Map<string, string>,
): Promise<string> {
  const diffContent = files
    .map((f) => {
      const diff = diffs.get(f) || '';
      if (diff.length > 3000) {
        const lines = diff.split('\n');
        return `=== ${f} ===\n${lines.slice(0, 50).join('\n')}\n[truncated]`;
      }
      return `=== ${f} ===\n${diff}`;
    })
    .join('\n\n');

  const prompt = `Generate a one-line git commit message for these changes.

Rules:
- Format: type: description (feat, fix, docs, refactor, test, chore)
- Lowercase only, no period at end
- Focus on WHAT changed and WHY, not file names
- Be specific about the actual code changes
- Max 72 characters
- NEVER mention AI, assistant, or co-author

Changes:
${diffContent}

Respond with ONLY the commit message, nothing else.`;

  try {
    const result = await generateText({
      model,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = result.text.trim().replace(/^["']|["']$/g, '');
    if (msg && msg.length < 100) return msg;
  } catch {}

  const mainType = files.some((f) => f.includes('test')) ? 'test' : 'feat';
  if (files.length === 1) {
    return `${mainType}: ${files[0]
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '')}`;
  }
  return `${mainType}: update ${files.length} files`;
}

export const commit: CommandHandler = async (ctx, args) => {
  const statusResult = spawnSync('git', ['status', '--porcelain'], {
    encoding: 'utf-8',
  });
  if (statusResult.error || statusResult.status !== 0) {
    return { output: 'not a git repository' };
  }

  const statusLines =
    statusResult.stdout?.trim().split('\n').filter(Boolean) || [];
  if (statusLines.length === 0) {
    return { output: 'nothing to commit' };
  }

  const toStage: string[] = [];
  const alreadyStaged: string[] = [];

  for (const line of statusLines) {
    const index = line[0];
    const worktree = line[1];
    const file = line.slice(3);

    if (shouldIgnore(file)) continue;

    if (index !== ' ' && index !== '?') {
      alreadyStaged.push(file);
    }

    if (
      worktree === 'M' ||
      worktree === 'A' ||
      worktree === 'D' ||
      index === '?'
    ) {
      if (!shouldIgnore(file)) {
        toStage.push(file);
      }
    }
  }

  if (toStage.length > 0) {
    const addResult = spawnSync('git', ['add', ...toStage], {
      encoding: 'utf-8',
    });
    if (addResult.status !== 0) {
      return { output: addResult.stderr?.trim() || 'failed to stage files' };
    }
  }

  const allFiles = [...new Set([...alreadyStaged, ...toStage])];
  if (allFiles.length === 0) {
    return { output: 'no files to commit (all ignored)' };
  }

  const diffs = new Map<string, string>();
  for (const file of allFiles) {
    const diffResult = spawnSync('git', ['diff', '--staged', '--', file], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    diffs.set(file, diffResult.stdout || '');
  }

  const totalDiff = [...diffs.values()].join('').length;
  if (totalDiff > 50000 && args !== 'all') {
    return {
      output: `diff too large (${Math.round(totalDiff / 1000)}kb). use /commit all to force.`,
    };
  }

  const message = await generateMessage(ctx.model, allFiles, diffs);
  if (!message) {
    return { output: 'could not generate commit message' };
  }

  const commitResult = spawnSync('git', ['commit', '-m', message], {
    encoding: 'utf-8',
  });
  if (commitResult.status !== 0) {
    const err = commitResult.stderr?.trim() || 'commit failed';
    return { output: err };
  }

  const fileList =
    allFiles.length <= 3
      ? allFiles.map((f) => f.split('/').pop()).join(', ')
      : `${allFiles.length} files`;

  return { output: `${message}\n${fileList}` };
};
