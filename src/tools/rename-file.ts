import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { pathError, safePath } from '../utils/safe-path.js';
import { saveRename } from '../utils/undo.js';

export const renameFile = tool({
  description: 'Rename or move a file.',
  inputSchema: z.object({
    oldPath: z.string().describe('Absolute or relative current path'),
    newPath: z.string().describe('Absolute or relative new path'),
  }),
  execute: async ({ oldPath, newPath }) => {
    try {
      const fullOldPath = safePath(oldPath);
      if (!fullOldPath) return { error: pathError(oldPath) };

      const fullNewPath = safePath(newPath);
      if (!fullNewPath) return { error: pathError(newPath) };

      if (!fs.existsSync(fullOldPath)) {
        return { error: `not found: ${oldPath}` };
      }

      const newDir = path.dirname(fullNewPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      saveRename(oldPath, newPath);
      fs.renameSync(fullOldPath, fullNewPath);
      return { message: `renamed to ${newPath}`, silent: true };
    } catch {
      return { error: `rename failed: ${oldPath}` };
    }
  },
});
