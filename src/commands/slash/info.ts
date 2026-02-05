import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listChats } from '../../config/chats.js';
import { GATEWAY_URL } from '../../utils/models.js';
import type { CommandHandler } from './types.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let size = 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const stat = fs.statSync(path.join(dirPath, file));
    size += stat.size;
  }
  return size;
}

export const info: CommandHandler = async (ctx) => {
  const home = os.homedir();
  const configPath = path.join(home, '.airc');
  const chatsDir = path.join(home, '.ai-chats');

  const configSize = fs.existsSync(configPath)
    ? fs.statSync(configPath).size
    : 0;
  const chatsSize = getDirSize(chatsDir);
  const chatCount = listChats().length;

  let balance = '...';
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/credits`, {
      headers: {
        Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { balance: string };
      balance = `$${Number.parseFloat(data.balance).toFixed(2)}`;
    }
  } catch {}

  const link = '\x1b]8;;https://x.com/nishimiya\x07x.com/nishimiya\x1b]8;;\x07';
  const lines = [
    `ai v${ctx.version}`,
    `model: ${ctx.model}`,
    `balance: ${balance}`,
    '',
    'storage:',
    `  config: ${formatBytes(configSize)}`,
    `  chats:  ${formatBytes(chatsSize)} (${chatCount} chats)`,
    '',
    `feedback: ${link}`,
  ];

  return { output: lines.join('\n') };
};
