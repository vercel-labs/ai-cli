import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { ensureBaseDir, MEMORIES_FILE } from '../config/paths.js';

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
    // Corrupt or unreadable memories file - start fresh
  }
  return [];
}

function saveMemories(memories: string[]): void {
  ensureBaseDir();
  fs.writeFileSync(MEMORIES_FILE, JSON.stringify(memories, null, 2), 'utf-8');
}

export const memory = tool({
  description:
    'Save or recall user preferences for future sessions. ONLY use when user explicitly says "remember this" or "save this". Do NOT use for questions like "what time is it" - use runCommand instead.',
  inputSchema: z.object({
    action: z.enum(['save', 'list', 'clear']).describe('Action to perform'),
    fact: z.string().optional().describe('Fact to save (required for save)'),
  }),
  execute: async ({ action, fact }) => {
    const memories = loadMemories();

    if (action === 'save') {
      if (!fact) return { error: 'No fact provided' };
      const clean = fact.trim().replace(/^-\s*/, '');
      if (memories.includes(clean)) {
        return { message: 'remembered', silent: true };
      }
      memories.push(clean);
      saveMemories(memories);
      return { message: 'remembered', silent: true };
    }

    if (action === 'list') {
      if (memories.length === 0) {
        return { memories: [], output: 'No saved memories' };
      }
      return { memories, output: memories.map((m) => `- ${m}`).join('\n') };
    }

    if (action === 'clear') {
      if (fs.existsSync(MEMORIES_FILE)) {
        fs.unlinkSync(MEMORIES_FILE);
      }
      return { message: 'memories cleared', silent: true };
    }

    return { error: 'Unknown action' };
  },
});
