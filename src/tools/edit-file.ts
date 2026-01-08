import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { saveWrite } from '../utils/undo.js';
import { confirm } from './confirm.js';

function shortDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n').slice(0, 5);
  const newLines = newText.split('\n').slice(0, 5);
  const lines: string[] = [];
  for (const line of oldLines) lines.push(`- ${line}`);
  for (const line of newLines) lines.push(`+ ${line}`);
  const more = Math.max(oldText.split('\n').length, newText.split('\n').length) - 5;
  if (more > 0) lines.push(`  ... ${more} more lines`);
  return lines.join('\n');
}

export const editFile = tool({
  description:
    'Edit a file by replacing old text with new text. Much faster than writeFile for small changes. The tool reads the file, so you dont need to read it first.',
  inputSchema: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    oldText: z.string().describe('Exact text to find (include 2-3 lines of context)'),
    newText: z.string().describe('Text to replace it with'),
  }),
  execute: async ({ filePath, oldText, newText }) => {
    debug(`editFile: ${filePath}`);
    try {
      const fullPath = path.resolve(filePath);

      if (!fs.existsSync(fullPath)) {
        return { error: `File not found: ${filePath}` };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      if (!content.includes(oldText)) {
        return { error: 'Could not find text to replace. Check whitespace and context.' };
      }

      const diff = shortDiff(oldText, newText);
      const ok = await confirm(`edit ${path.basename(filePath)}?\n${diff}`);
      if (!ok) {
        return { message: 'cancelled', silent: true };
      }

      saveWrite(fullPath);
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(fullPath, updated, 'utf-8');

      return { message: `edited ${filePath}`, silent: true };
    } catch (e) {
      return { error: `Failed to edit: ${(e as Error).message}` };
    }
  },
});
