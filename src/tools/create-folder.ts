import * as fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import { pathError, safePath } from '../utils/safe-path.js';

export const createFolder = tool({
  description: 'Create a new folder/directory.',
  inputSchema: z.object({
    folderPath: z.string().describe('Absolute or relative path to create'),
  }),
  execute: async ({ folderPath }) => {
    try {
      const fullPath = safePath(folderPath);
      if (!fullPath) return { error: pathError(folderPath) };

      if (fs.existsSync(fullPath)) {
        return { error: `exists: ${folderPath}` };
      }

      fs.mkdirSync(fullPath, { recursive: true });
      return { message: `created ${folderPath}`, silent: true };
    } catch {
      return { error: `create failed: ${folderPath}` };
    }
  },
});
