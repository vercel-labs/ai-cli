import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';
import { saveDelete } from '../utils/undo.js';

export const deleteFile = tool({
  description: 'Delete a file.',
  inputSchema: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
  }),
  execute: async ({ filePath }) => {
    try {
      const fullPath = path.resolve(filePath);

      if (!fs.existsSync(fullPath)) {
        return { error: `File not found: ${filePath}` };
      }

      saveDelete(fullPath);
      fs.unlinkSync(fullPath);
      process.stdout.write(`\r\x1b[K${dim(`done. deleted ${filePath}`)}\n`);

      return { success: true, silent: true };
    } catch (e) {
      return { error: `Failed to delete: ${(e as Error).message}` };
    }
  },
});

