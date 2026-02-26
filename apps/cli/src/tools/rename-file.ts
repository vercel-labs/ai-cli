import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveAnyPath, safePath } from '../utils/safe-path.js';
import { saveRename } from '../utils/undo.js';
import { confirm } from './confirm.js';

export const renameFile = tool({
  description: 'Rename or move a file.',
  inputSchema: z.object({
    oldPath: z.string().describe('Absolute or relative current path'),
    newPath: z.string().describe('Absolute or relative new path'),
  }),
  execute: async ({ oldPath, newPath }) => {
    try {
      let fullOldPath = safePath(oldPath);
      if (!fullOldPath) {
        const allowed = await confirm(
          `rename from outside project: ${oldPath}`,
          { tool: 'renameFile', noAlways: true },
        );
        if (!allowed)
          return { error: 'User denied access to path outside project.' };
        fullOldPath = resolveAnyPath(oldPath);
      }

      let fullNewPath = safePath(newPath);
      if (!fullNewPath) {
        const allowed = await confirm(`rename to outside project: ${newPath}`, {
          tool: 'renameFile',
          noAlways: true,
        });
        if (!allowed)
          return { error: 'User denied access to path outside project.' };
        fullNewPath = resolveAnyPath(newPath);
      }

      if (!fs.existsSync(fullOldPath)) {
        return { error: `not found: ${oldPath}` };
      }

      const newDir = path.dirname(fullNewPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      saveRename(oldPath, newPath);
      fs.renameSync(fullOldPath, fullNewPath);
      return { message: `Renamed to ${newPath}`, silent: true };
    } catch {
      return { error: `rename failed: ${oldPath}` };
    }
  },
});
