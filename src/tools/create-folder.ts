import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

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
      return { message: `created ${folderPath}`, silent: true };
    } catch (e) {
      return { error: `Failed to create folder: ${(e as Error).message}` };
    }
  },
});
