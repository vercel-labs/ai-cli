import { spawnSync } from 'node:child_process';
import { commit } from './commit.js';
import type { CommandHandler } from './types.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function formatGitDiff(raw: string): string {
  const chunks = raw.split(/^diff --git /m).filter(Boolean);
  const formatted: string[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const headerLine = lines[0] || '';
    const match = headerLine.match(/b\/(.+)$/);
    const file = match ? match[1] : headerLine;

    const adds = lines.filter(
      (l) => l.startsWith('+') && !l.startsWith('+++'),
    ).length;
    const dels = lines.filter(
      (l) => l.startsWith('-') && !l.startsWith('---'),
    ).length;

    if (adds + dels > 40) {
      formatted.push(`${cyan(file)} ${dim(`+${adds} -${dels}`)}`);
      continue;
    }

    formatted.push(cyan(file));
    for (const line of lines.slice(1)) {
      if (
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('@@')
      )
        continue;
      if (line.startsWith('-')) formatted.push(red(line));
      else if (line.startsWith('+')) formatted.push(green(line));
    }
    formatted.push('');
  }

  return formatted.join('\n').trim();
}

function gitDiff(staged: boolean): { output: string } {
  const args = staged
    ? [
        'diff',
        '--staged',
        '--',
        ':!dist',
        ':!*.min.js',
        ':!*.min.css',
        ':!package-lock.json',
        ':!pnpm-lock.yaml',
        ':!yarn.lock',
      ]
    : [
        'diff',
        '--',
        ':!dist',
        ':!*.min.js',
        ':!*.min.css',
        ':!package-lock.json',
        ':!pnpm-lock.yaml',
        ':!yarn.lock',
      ];

  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) return { output: 'git not found' };
  if (result.status !== 0) {
    const err = result.stderr?.trim() || '';
    if (err.includes('not a git repository'))
      return { output: 'not a git repository' };
    return { output: err || 'git error' };
  }
  const output = result.stdout?.trim() || '';
  if (!output)
    return { output: staged ? 'no staged changes' : 'no unstaged changes' };
  return { output: formatGitDiff(output) };
}

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

  if (sub === 'diff' || sub === 'd') {
    return gitDiff(false);
  }

  if (sub === 'staged') {
    return gitDiff(true);
  }

  if (sub === 'status' || sub === 's') {
    const result = spawnSync('git', ['status', '--porcelain'], {
      encoding: 'utf-8',
    });
    if (result.error || result.status !== 0) {
      return { output: 'not a git repository' };
    }
    return { output: formatStatus(result.stdout || '') };
  }

  if (sub === 'commit' || sub === 'c') {
    return commit(ctx, param);
  }

  if (sub === 'push' || sub === 'p') {
    const result = spawnSync('git', ['push'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      const err = result.stderr?.trim() || '';
      if (err.includes('no upstream')) {
        const branch = spawnSync('git', ['branch', '--show-current'], {
          encoding: 'utf-8',
        });
        const name = branch.stdout?.trim() || 'HEAD';
        const push = spawnSync('git', ['push', '-u', 'origin', name], {
          encoding: 'utf-8',
        });
        if (push.status === 0) {
          return { output: `pushed ${name} (set upstream)` };
        }
        return { output: push.stderr?.trim() || 'push failed' };
      }
      return { output: err || 'push failed' };
    }
    return {
      output: result.stderr?.includes('Everything up-to-date')
        ? 'up to date'
        : 'pushed',
    };
  }

  if (sub === 'pull') {
    const result = spawnSync('git', ['pull'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      return { output: result.stderr?.trim() || 'pull failed' };
    }
    return {
      output: result.stdout?.includes('Already up to date')
        ? 'up to date'
        : 'pulled',
    };
  }

  if (sub === 'log' || sub === 'l') {
    const n = param ? parseInt(param, 10) : 10;
    const result = spawnSync(
      'git',
      ['log', `--oneline`, `-${Number.isNaN(n) ? 10 : n}`],
      { encoding: 'utf-8' },
    );
    if (result.error || result.status !== 0) {
      return { output: 'not a git repository' };
    }
    const lines = result.stdout?.trim().split('\n').filter(Boolean) || [];
    const formatted = lines.map((line) => {
      const [hash, ...rest] = line.split(' ');
      return `${dim(hash)} ${rest.join(' ')}`;
    });
    return { output: formatted.join('\n') || 'no commits' };
  }

  if (sub === 'stash') {
    if (param === 'pop' || param === 'p') {
      const result = spawnSync('git', ['stash', 'pop'], { encoding: 'utf-8' });
      if (result.status !== 0) {
        return { output: result.stderr?.trim() || 'stash pop failed' };
      }
      return { output: 'popped' };
    }
    if (param === 'list' || param === 'l') {
      const result = spawnSync('git', ['stash', 'list'], { encoding: 'utf-8' });
      return { output: result.stdout?.trim() || 'no stashes' };
    }
    const result = spawnSync('git', ['stash'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      return { output: result.stderr?.trim() || 'stash failed' };
    }
    return {
      output: result.stdout?.includes('No local changes')
        ? 'nothing to stash'
        : 'stashed',
    };
  }

  if (sub === 'branch' || sub === 'b') {
    if (param) {
      const result = spawnSync('git', ['checkout', param], {
        encoding: 'utf-8',
      });
      if (result.status !== 0) {
        const err = result.stderr?.trim() || '';
        if (err.includes('did not match')) {
          const create = spawnSync('git', ['checkout', '-b', param], {
            encoding: 'utf-8',
          });
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

  return {
    output: 'usage: /git diff|staged|status|branch|commit|push|pull|log|stash',
  };
};
