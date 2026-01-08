import { saveChat } from '../../config/chats.js';
import { summarizeHistory } from '../../utils/context.js';
import type { CommandHandler } from './types.js';

export const compress: CommandHandler = async (ctx) => {
  if (!ctx.chat) {
    return { output: 'no active chat' };
  }
  if (ctx.history.length < 3) {
    return { output: 'not enough history to compress' };
  }

  const summary = await summarizeHistory(ctx.history);

  if (!summary) {
    return { output: 'compression failed' };
  }

  ctx.history.length = 0;

  const estimatedTokens = Math.round(summary.length / 4);

  ctx.chat.summary = summary;
  ctx.chat.messages = [];
  ctx.chat.tokens = estimatedTokens;
  saveChat(ctx.chat);

  return {
    output: `compressed to ~${estimatedTokens.toLocaleString()} tokens\ntype /summary to view`,
    tokens: estimatedTokens,
    cost: ctx.cost,
    summary,
  };
};

