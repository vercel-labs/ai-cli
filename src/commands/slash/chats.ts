import { listChats } from '../../config/chats.js';
import type { CommandHandler } from './types.js';

const PAGE_SIZE = 10;

export const chats: CommandHandler = (ctx, args) => {
  const allChats = listChats();
  if (allChats.length === 0) {
    return { output: 'no saved chats' };
  }

  const page = Math.max(1, Number.parseInt(args || '1', 10) || 1);
  const totalPages = Math.ceil(allChats.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, allChats.length);
  const pageChats = allChats.slice(start, end);

  const lines: string[] = [`saved chats (page ${page}/${totalPages}):`];
  for (let i = 0; i < pageChats.length; i++) {
    const c = pageChats[i];
    const date = new Date(c.updatedAt).toLocaleDateString();
    const num = start + i + 1;
    const prefix = ctx.chat && c.id === ctx.chat.id ? '› ' : '  ';
    lines.push(`${prefix}${num}. ${c.title} (${date})`);
  }

  if (totalPages > 1) {
    lines.push('\n/chats <page> for more, /chat <number> to load');
  } else {
    lines.push('\n/chat <number> to load');
  }
  return { output: lines.join('\n') };
};
