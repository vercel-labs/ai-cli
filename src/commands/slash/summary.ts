import type { CommandHandler, Context } from './types.js';

export const summary: CommandHandler = (ctx: Context) => {
  const s = ctx.chat?.summary;

  if (!s) {
    return { output: 'no summary. use /compress first' };
  }

  return { output: `--- session summary ---\n${s}\n--- end summary ---` };
};

