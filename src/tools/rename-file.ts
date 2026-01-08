import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';
import { saveRename } from '../utils/undo.js';

function fileLink(fullPath: string, name: string): string {
  return `\x1b]8;;file://${fullPath}\x1b\\${name}\x1b]8;;\x1b\\`;
}

export const renameFile = tool({
  description: 'Rename or move a file.',
  inputSchema: z.object({
    oldPath: z.string().describe('Absolute or relative current path'),
    newPath: z.string().describe('Absolute or relative new path'),
  }),
  execute: async ({ oldPath, newPath }) => {
    try {
      const fullOldPath = path.resolve(oldPath);
      const fullNewPath = path.resolve(newPath);

      if (!fs.existsSync(fullOldPath)) {
        return { error: `File not found: ${oldPath}` };
      }

      const newDir = path.dirname(fullNewPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      saveRename(oldPath, newPath);
      fs.renameSync(fullOldPath, fullNewPath);
      const link = fileLink(fullNewPath, newPath);
      process.stdout.write(`\r\x1b[K${dim(`done. renamed to ${link}`)}\n`);

      return { success: true, silent: true };
    } catch (e) {
      return { error: `Failed to rename: ${(e as Error).message}` };
    }
  },
});

