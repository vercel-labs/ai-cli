import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dim } from 'yoctocolors';
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
      console.log(dim('\nmemories cleared\n'));
    } else {
      console.log(dim('\nno memories to clear\n'));
    }
    return undefined;
  }

  const memories = loadMemories();

  if (memories.length === 0) {
    console.log(dim('\nno saved memories'));
    console.log(dim('say "remember X" to save facts\n'));
    return undefined;
  }

  console.log(dim(`\nmemories (${memories.length}):`));
  for (const mem of memories) {
    console.log(dim(`  - ${mem}`));
  }
  console.log(dim('\nuse /memory clear to delete all\n'));
  return undefined;
};
