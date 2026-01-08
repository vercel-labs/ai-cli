import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';

function fileLink(fullPath: string, name: string): string {
  return `\x1b]8;;file://${fullPath}\x1b\\${name}\x1b]8;;\x1b\\`;
}

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
      const link = fileLink(fullDestPath, destPath);
      process.stdout.write(`\r\x1b[K${dim(`done. copied to ${link}`)}\n`);

      return { success: true, silent: true };
    } catch (e) {
      return { error: `Failed to copy: ${(e as Error).message}` };
    }
  },
});

