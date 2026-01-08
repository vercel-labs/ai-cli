import type { CommandHandler } from './types.js';

export const model: CommandHandler = (ctx) => {
  return { output: `current model: ${ctx.model}` };
};
