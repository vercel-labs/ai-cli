import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { saveWrite } from '../utils/undo.js';

function fileLink(fullPath: string, name: string): string {
  return `\x1b]8;;file://${fullPath}\x1b\\${name}\x1b]8;;\x1b\\`;
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

      saveWrite(fullPath);
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(fullPath, updated, 'utf-8');

      const link = fileLink(fullPath, filePath);
      process.stdout.write(`\r\x1b[K${dim(`edited ${link}`)}\n`);

      return { success: true, silent: true };
    } catch (e) {
      return { error: `Failed to edit: ${(e as Error).message}` };
    }
  },
});
