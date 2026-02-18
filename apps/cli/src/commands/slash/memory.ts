import * as fs from 'node:fs';
import { MEMORIES_FILE } from '../../config/paths.js';
import { migrateOldMemories } from '../../utils/memory-migration.js';
import type { CommandHandler } from './types.js';

function loadMemories(): string[] {
  migrateOldMemories();
  try {
    if (fs.existsSync(MEMORIES_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf-8'));
      return Array.isArray(data) ? data : [];
    }
  } catch {
    // Corrupt or unreadable memories file
  }
  return [];
}

export const memory: CommandHandler = (_ctx, args) => {
  const action = args?.trim().toLowerCase();

  if (action === 'clear') {
    if (fs.existsSync(MEMORIES_FILE)) {
      fs.unlinkSync(MEMORIES_FILE);
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
