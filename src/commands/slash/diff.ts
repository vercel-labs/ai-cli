import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createUnifiedDiff } from '../../utils/diff.js';
import { getStack, getOperation } from '../../utils/undo.js';
import type { CommandHandler } from './types.js';

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function formatGitDiff(raw: string): string {
  const chunks = raw.split(/^diff --git /m).filter(Boolean);
  const formatted: string[] = [];
  const maxLines = 40;

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const headerLine = lines[0] || '';
    const match = headerLine.match(/b\/(.+)$/);
    const file = match ? match[1] : headerLine;

    const adds = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
    const dels = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

    if (adds + dels > maxLines) {
      const stat = `+${adds} -${dels}`;
      formatted.push(`${cyan(file)} ${dim(stat)}`);
      continue;
    }

    formatted.push(cyan(file));

    for (const line of lines.slice(1)) {
      if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        continue;
      } else if (line.startsWith('@@')) {
        continue;
      } else if (line.startsWith('-')) {
        formatted.push(red(line));
      } else if (line.startsWith('+')) {
        formatted.push(green(line));
      }
    }
    formatted.push('');
  }

  return formatted.join('\n').trim();
}

export const diff: CommandHandler = (_ctx, args) => {
  const arg = args?.trim();

  if (arg === 'git' || arg === 'staged') {
    const gitArgs = arg === 'staged'
      ? ['diff', '--staged', '--', ':!dist', ':!*.min.js', ':!*.min.css', ':!package-lock.json', ':!pnpm-lock.yaml', ':!yarn.lock']
      : ['diff', '--', ':!dist', ':!*.min.js', ':!*.min.css', ':!package-lock.json', ':!pnpm-lock.yaml', ':!yarn.lock'];

    const result = spawnSync('git', gitArgs, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    if (result.error) {
      return { output: 'git not found' };
    }
    if (result.status !== 0) {
      const err = result.stderr?.trim() || '';
      if (err.includes('not a git repository')) {
        return { output: 'not a git repository' };
      }
      return { output: err || 'git error' };
    }
    const output = result.stdout?.trim() || '';
    if (!output) {
      return { output: arg === 'staged' ? 'no staged changes' : 'no unstaged changes' };
    }
    return { output: formatGitDiff(output) };
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
