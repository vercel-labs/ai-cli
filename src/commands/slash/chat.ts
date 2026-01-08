import { type Chat, listChats, searchChats } from '../../config/chats.js';
import type { CommandHandler, CommandResult } from './types.js';

export const chat: CommandHandler = (_ctx, args) => {
  const query = args?.trim() || '';
  if (!query) {
    return { output: 'usage: /chat <number or search>' };
  }

  const num = Number.parseInt(query, 10);
  const allChats = listChats();
  let found: Chat | undefined;

  if (!Number.isNaN(num) && num > 0 && num <= allChats.length) {
    found = allChats[num - 1];
  } else {
    const results = searchChats(query);
    if (results.length > 0) found = results[0];
  }

  if (!found) {
    return { output: 'chat not found' };
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
