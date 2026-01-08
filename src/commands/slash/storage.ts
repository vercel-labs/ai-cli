import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listChats } from '../../config/chats.js';
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

export const storage: CommandHandler = () => {
  const home = os.homedir();
  const configPath = path.join(home, '.airc');
  const chatsDir = path.join(home, '.ai-chats');

  const configSize = fs.existsSync(configPath)
    ? fs.statSync(configPath).size
    : 0;
  const chatsSize = getDirSize(chatsDir);
  const chatCount = listChats().length;

  const output = `storage:
  config: ${configPath} (${formatBytes(configSize)})
  chats:  ${chatsDir}/ (${formatBytes(chatsSize)}, ${chatCount} chats)
  total:  ${formatBytes(configSize + chatsSize)}

use /purge to delete all chats`;
  return { output };
};
