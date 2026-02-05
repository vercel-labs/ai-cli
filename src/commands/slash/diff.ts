import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createUnifiedDiff } from '../../utils/diff.js';
import { getStack, getOperation } from '../../utils/undo.js';
import type { CommandHandler } from './types.js';

export const diff: CommandHandler = (_ctx, args) => {
  const arg = args?.trim();

  if (arg === 'git') {
    try {
      const output = execSync('git diff', { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      if (!output.trim()) {
        return { output: 'no unstaged changes' };
      }
      return { output: output.trim() };
    } catch {
      return { output: 'not a git repository' };
    }
  }

  if (arg === 'staged') {
    try {
      const output = execSync('git diff --staged', { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      if (!output.trim()) {
        return { output: 'no staged changes' };
      }
      return { output: output.trim() };
    } catch {
      return { output: 'not a git repository' };
    }
  }

  const items = getStack();

  if (items.length === 0 && !arg) {
    return { output: 'no recent changes (try /diff git)' };
  }

  if (!arg) {
    const lines = ['recent changes (use /diff <n> to view):'];
    for (const item of items.slice(0, 10)) {
      lines.push(`  ${item.index}. ${item.action} ${item.file} (${item.time})`);
    }
    return { output: lines.join('\n') };
  }

  const num = parseInt(arg, 10);
  if (isNaN(num) || num < 1 || num > items.length) {
    return { output: `invalid index. use 1-${items.length}` };
  }

  const item = items.find(i => i.index === num);
  const op = getOperation(num);
  if (!item || !op) {
    return { output: 'change not found' };
  }

  const lines: string[] = [`${item.action} ${item.file} (${item.time})`];

  if (op.type === 'write') {
    const oldContent = op.previous || '';
    let newContent = '';
    try {
      newContent = fs.readFileSync(op.path, 'utf-8');
    } catch {}
    const diffOutput = createUnifiedDiff(oldContent, newContent);
    if (diffOutput) {
      lines.push('');
      lines.push(diffOutput);
    }
  } else if (op.type === 'delete') {
    lines.push('');
    for (const line of op.content.split('\n').slice(0, 20)) {
      lines.push(`- ${line}`);
    }
    if (op.content.split('\n').length > 20) {
      lines.push('  ...');
    }
  } else if (op.type === 'rename') {
    lines.push(`  ${op.oldPath} -> ${op.newPath}`);
  }

  lines.push('');
  lines.push(`use /rollback ${num} to undo`);

  return { output: lines.join('\n') };
};
