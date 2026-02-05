import { diff } from './diff.js';
import type { CommandHandler } from './types.js';

export const git: CommandHandler = (ctx, args) => {
  const sub = args?.trim().split(' ')[0]?.toLowerCase();

  if (sub === 'diff') {
    return diff(ctx, 'git');
  }

  if (sub === 'staged') {
    return diff(ctx, 'staged');
  }

  return { output: 'usage: /git diff, /git staged' };
};
