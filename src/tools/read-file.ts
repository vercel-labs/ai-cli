import * as fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import { mask } from '../utils/mask.js';
import { resolveAnyPath, safePath } from '../utils/safe-path.js';
import { confirm } from './confirm.js';

export const readFile = tool({
  description:
    'Read the contents of a file. When showing file contents to the user, use plain text with code blocks only for actual code.',
  inputSchema: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
  }),
  execute: async ({ filePath }) => {
    try {
      let fullPath = safePath(filePath);
      if (!fullPath) {
        const allowed = await confirm(
          `read file outside project: ${filePath}`,
          { tool: 'readFile', noAlways: true },
        );
        if (!allowed)
          return { error: 'User denied access to file outside project.' };
        fullPath = resolveAnyPath(filePath);
      }

      if (!fs.existsSync(fullPath)) {
        return {
          error: `file not found: ${filePath}. Check <project-files> for the correct path.`,
        };
      }

      const content = mask(fs.readFileSync(fullPath, 'utf-8'));
      const lines = content.split('\n').length;
      if (lines > 500) {
        return {
          content: content.slice(0, 10000),
          truncated: true,
          totalLines: lines,
        };
      }
      return { content, truncated: false, totalLines: lines };
    } catch {
      return { error: `read failed: ${filePath}` };
    }
  },
});
