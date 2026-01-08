import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommandHandler } from './types.js';

const memoryFile = path.join(os.homedir(), '.ai-memories');

function loadMemories(): string[] {
  try {
    if (fs.existsSync(memoryFile)) {
      return fs.readFileSync(memoryFile, 'utf-8').split('\n').filter(Boolean);
    }
  } catch {}
  return [];
}

export const memory: CommandHandler = (_ctx, args) => {
  const action = args?.trim().toLowerCase();

  if (action === 'clear') {
    if (fs.existsSync(memoryFile)) {
      fs.unlinkSync(memoryFile);
      return { output: 'memories cleared' };
    }
    return { output: 'no memories to clear' };
  }

  const memories = loadMemories();

  if (memories.length === 0) {
    return { output: 'no saved memories\nsay "remember X" to save facts' };
  }

  const lines = [`memories (${memories.length}):`];
  for (const mem of memories) {
    lines.push(`  - ${mem}`);
  }
  lines.push('\nuse /memory clear to delete all');
  return { output: lines.join('\n') };
};
