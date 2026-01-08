import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';

function fileLink(fullPath: string, name: string): string {
  return `\x1b]8;;file://${fullPath}\x1b\\${name}\x1b]8;;\x1b\\`;
}

export const createFolder = tool({
  description: 'Create a new folder/directory.',
  inputSchema: z.object({
    folderPath: z.string().describe('Absolute or relative path to create'),
  }),
  execute: async ({ folderPath }) => {
    try {
      const fullPath = path.resolve(folderPath);

      if (fs.existsSync(fullPath)) {
        return { error: `Folder already exists: ${folderPath}` };
      }

      fs.mkdirSync(fullPath, { recursive: true });
      const link = fileLink(fullPath, folderPath);
      process.stdout.write(`\r\x1b[K${dim(`done. created ${link}`)}\n`);

      return { success: true, silent: true };
    } catch (e) {
      return { error: `Failed to create folder: ${(e as Error).message}` };
    }
  },
});

