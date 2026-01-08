import type { CommandHandler } from './types.js';

function formatCost(cost: number): string {
  if (cost === 0) return '$0.0000';
  if (cost > 0 && cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}

export const usage: CommandHandler = (ctx) => {
  if (!ctx.chat) {
    return { output: 'no active chat' };
  }
  const userMsgs = ctx.chat.messages.filter((m) => m.role === 'user').length;
  const aiMsgs = ctx.chat.messages.filter((m) => m.role === 'assistant').length;
  const output = `chat: ${ctx.chat.title}
model: ${ctx.model}
messages: ${userMsgs} user / ${aiMsgs} assistant
tokens: ~${ctx.tokens.toLocaleString()}
cost: ${formatCost(ctx.cost)}`;
  return { output };
};
