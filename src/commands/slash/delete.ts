import { deleteChat } from '../../config/chats.js';
import type { CommandHandler } from './types.js';

export const deleteCmd: CommandHandler = (ctx) => {
  if (!ctx.chat || ctx.chat.messages.length === 0) {
    return { output: 'nothing to delete' };
  }

  deleteChat(ctx.chat.id);
  return { chat: null, tokens: 0, cost: 0, clearHistory: true, clearScreen: true, output: 'chat deleted' };
};
