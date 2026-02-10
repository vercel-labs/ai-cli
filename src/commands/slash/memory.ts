import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureBaseDir, MEMORIES_FILE } from '../../config/paths.js';
import type { CommandHandler } from './types.js';

const OLD_MEMORY_FILE = path.join(os.homedir(), '.ai-memories');

function migrateOldMemories(): void {
  if (!fs.existsSync(OLD_MEMORY_FILE)) return;
  try {
    const lines = fs
      .readFileSync(OLD_MEMORY_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean);
    if (lines.length > 0) {
      ensureBaseDir();
      let existing: string[] = [];
      try {
        if (fs.existsSync(MEMORIES_FILE)) {
          const data = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf-8'));
          existing = Array.isArray(data) ? data : [];
        }
      } catch {}
      const merged = [...new Set([...existing, ...lines])];
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    }
    fs.unlinkSync(OLD_MEMORY_FILE);
  } catch {
    // Migration failed - old file will be retried next time
  }
}

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
