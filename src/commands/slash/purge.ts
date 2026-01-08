import { createChat, deleteAllChats, listChats } from '../../config/chats.js';
import type { CommandHandler } from './types.js';

export const purge: CommandHandler = (_ctx, args) => {
  const allChats = listChats();
  if (allChats.length === 0) {
    return { output: 'no chats to delete' };
  }

  if (args?.trim().toLowerCase() !== 'confirm') {
    return { output: `${allChats.length} chat(s) will be deleted\ntype /purge confirm to proceed` };
  }

  const deleted = deleteAllChats();
  const chat = createChat(_ctx.model);
  return { chat, tokens: 0, cost: 0, clearHistory: true, clearScreen: true, output: `deleted ${deleted} chat(s)` };
};
