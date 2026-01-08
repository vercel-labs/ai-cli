import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

export const readFile = tool({
  description:
    'Read the contents of a file. When showing file contents to the user, use plain text with code blocks only for actual code.',
  inputSchema: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
  }),
  execute: async ({ filePath }) => {
    try {
      const fullPath = path.resolve(filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').length;
      if (lines > 500) {
        return {
          content: content.slice(0, 10000),
          truncated: true,
          totalLines: lines,
        };
      }
      return { content, truncated: false, totalLines: lines };
    } catch (e) {
      return { error: `Failed to read file: ${(e as Error).message}` };
    }
  },
});
