import { spawnSync } from 'node:child_process';
import { diff } from './diff.js';
import type { CommandHandler } from './types.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function formatStatus(raw: string): string {
  const lines = raw.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return 'clean';

  const formatted: string[] = [];
  for (const line of lines) {
    const status = line.slice(0, 2);
    const file = line.slice(3);

    if (status.includes('M')) {
      formatted.push(`${cyan('M')} ${file}`);
    } else if (status.includes('A')) {
      formatted.push(`${green('A')} ${file}`);
    } else if (status.includes('D')) {
      formatted.push(`${red('D')} ${file}`);
    } else if (status.includes('?')) {
      formatted.push(`${dim('?')} ${file}`);
    } else {
      formatted.push(`${status} ${file}`);
    }
  }
  return formatted.join('\n');
}

function formatBranches(raw: string): string {
  const lines = raw.trim().split('\n').filter(Boolean);
  const formatted: string[] = [];

  for (const line of lines) {
    if (line.startsWith('*')) {
      formatted.push(green(line));
    } else {
      formatted.push(dim(line.trim()));
    }
  }
  return formatted.join('\n');
}

export const git: CommandHandler = (ctx, args) => {
  const parts = args?.trim().split(' ') || [];
  const sub = parts[0]?.toLowerCase();
  const param = parts.slice(1).join(' ');

  if (sub === 'diff') {
    return diff(ctx, 'git');
  }

  if (sub === 'staged') {
    return diff(ctx, 'staged');
  }

  if (sub === 'status' || sub === 's') {
    const result = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8' });
    if (result.error || result.status !== 0) {
      return { output: 'not a git repository' };
    }
    return { output: formatStatus(result.stdout || '') };
  }

  if (sub === 'branch' || sub === 'b') {
    if (param) {
      const result = spawnSync('git', ['checkout', param], { encoding: 'utf-8' });
      if (result.status !== 0) {
        const err = result.stderr?.trim() || '';
        if (err.includes('did not match')) {
          const create = spawnSync('git', ['checkout', '-b', param], { encoding: 'utf-8' });
          if (create.status === 0) {
            return { output: `created and switched to ${param}` };
          }
          return { output: create.stderr?.trim() || 'failed to create branch' };
        }
        return { output: err || 'failed to switch branch' };
      }
      return { output: `switched to ${param}` };
    }

    const result = spawnSync('git', ['branch'], { encoding: 'utf-8' });
    if (result.error || result.status !== 0) {
      return { output: 'not a git repository' };
    }
    return { output: formatBranches(result.stdout || '') };
  }

  return { output: 'usage: /git diff, /git staged, /git status, /git branch [name]' };
};
