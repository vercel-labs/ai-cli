import {
  type Chat,
  createChat,
  deleteAllChats,
  deleteChat,
  listChats,
  searchChats,
} from '../../config/chats.js';
import type { CommandHandler, CommandResult } from './types.js';

const PAGE_SIZE = 10;

export const chat: CommandHandler = (ctx, args) => {
  const query = args?.trim().toLowerCase() || '';
  const allChats = listChats();

  if (query === 'new' || query === 'n') {
    const chat = createChat(ctx.model);
    return { chat, tokens: 0, cost: 0, clearHistory: true, clearScreen: true };
  }

  if (query === 'delete all') {
    if (allChats.length === 0) {
      return { output: 'no chats' };
    }
    const deleted = deleteAllChats();
    const chat = createChat(ctx.model);
    return {
      chat,
      tokens: 0,
      cost: 0,
      clearHistory: true,
      clearScreen: true,
      output: `deleted ${deleted} chat(s)`,
    };
  }

  if (query === 'delete' || query === 'd') {
    if (!ctx.chat || ctx.chat.messages.length === 0) {
      return { output: 'nothing to delete' };
    }
    deleteChat(ctx.chat.id);
    return {
      chat: null,
      tokens: 0,
      cost: 0,
      clearHistory: true,
      clearScreen: true,
      output: 'deleted',
    };
  }

  if (!query) {
    if (allChats.length === 0) {
      return { output: 'no saved chats' };
    }
    const lines: string[] = ['saved chats:'];
    for (let i = 0; i < Math.min(allChats.length, PAGE_SIZE); i++) {
      const c = allChats[i];
      const date = new Date(c.updatedAt).toLocaleDateString();
      const prefix = ctx.chat && c.id === ctx.chat.id ? '› ' : '  ';
      lines.push(`${prefix}${i + 1}. ${c.title} (${date})`);
    }
    if (allChats.length > PAGE_SIZE) {
      lines.push(`  ... and ${allChats.length - PAGE_SIZE} more`);
    }
    lines.push('\n/chat <n> | new | delete | delete all');
    return { output: lines.join('\n') };
  }

  const num = Number.parseInt(query, 10);
  let found: Chat | undefined;

  if (!Number.isNaN(num) && num > 0 && num <= allChats.length) {
    found = allChats[num - 1];
  } else {
    const results = searchChats(query);
    if (results.length > 0) found = results[0];
  }

  if (!found) {
    return { output: 'not found' };
  }

  const result: CommandResult = {
    chat: found,
    model: found.model,
    tokens: found.tokens || 0,
    cost: found.cost || 0,
    clearHistory: true,
    clearScreen: true,
  };

  return result;
};

export function restoreHistory(
  ctx: { chat: { messages: { role: string; content: string }[] } },
  history: { role: string; content: unknown }[],
): { user: string[]; assistant: string[] } {
  const restored = { user: [] as string[], assistant: [] as string[] };
  for (const msg of ctx.chat.messages) {
    if (msg.role === 'user') {
      history.push({ role: 'user', content: msg.content });
      restored.user.push(msg.content);
    } else if (msg.role === 'assistant') {
      history.push({
        role: 'assistant',
        content: [{ type: 'text', text: msg.content }],
      });
      restored.assistant.push(msg.content);
    }
  }
  return restored;
}
