import { createChat } from '../../config/chats.js';
import type { CommandHandler } from './types.js';

export const clear: CommandHandler = (ctx) => {
  const chat = createChat(ctx.model);
  return { chat, tokens: 0, cost: 0, clearHistory: true, clearScreen: true };
};
