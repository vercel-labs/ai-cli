import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

export const copyFile = tool({
  description: 'Copy a file to a new location.',
  inputSchema: z.object({
    sourcePath: z.string().describe('Absolute or relative path to source'),
    destPath: z.string().describe('Absolute or relative path to destination'),
  }),
  execute: async ({ sourcePath, destPath }) => {
    try {
      const fullSourcePath = path.resolve(sourcePath);
      const fullDestPath = path.resolve(destPath);

      if (!fs.existsSync(fullSourcePath)) {
        return { error: `Source file not found: ${sourcePath}` };
      }

      const destDir = path.dirname(fullDestPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.copyFileSync(fullSourcePath, fullDestPath);
      return { message: `copied to ${destPath}`, silent: true };
    } catch (e) {
      return { error: `Failed to copy: ${(e as Error).message}` };
    }
  },
});
