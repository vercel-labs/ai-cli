import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { tool } from 'ai';
import { z } from 'zod';

const memoryFile = path.join(os.homedir(), '.ai-memories');

function loadMemories(): string[] {
  try {
    if (fs.existsSync(memoryFile)) {
      return fs.readFileSync(memoryFile, 'utf-8').split('\n').filter(Boolean);
    }
  } catch {}
  return [];
}

function saveMemories(memories: string[]): void {
  fs.writeFileSync(memoryFile, memories.join('\n') + '\n', 'utf-8');
}

export const memory = tool({
  description:
    'Save or recall facts for future sessions. Stored in ~/.ai-memories. Use when user says "remember". After saving, do NOT respond - stay completely silent.',
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
      return { memories, output: memories.map(m => `- ${m}`).join('\n') };
    }

    if (action === 'clear') {
      if (fs.existsSync(memoryFile)) {
        fs.unlinkSync(memoryFile);
      }
      return { message: 'memories cleared', silent: true };
    }

    return { error: 'Unknown action' };
  },
});
