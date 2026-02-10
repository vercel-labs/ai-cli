import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { pathError, safePath } from '../utils/safe-path.js';
import { saveDelete } from '../utils/undo.js';
import { confirm } from './confirm.js';

export const deleteFile = tool({
  description: 'Delete one or more files or folders.',
  inputSchema: z.object({
    paths: z.array(z.string()).describe('Array of paths to delete'),
  }),
  execute: async ({ paths }) => {
    const deleted: string[] = [];
    const errors: string[] = [];

    // Validate paths before prompting the user
    const validPaths: { filePath: string; fullPath: string }[] = [];
    for (const filePath of paths) {
      const fullPath = safePath(filePath);
      if (!fullPath) {
        errors.push(pathError(filePath));
        continue;
      }
      if (!fs.existsSync(fullPath)) {
        errors.push(`not found: ${filePath}`);
        continue;
      }
      validPaths.push({ filePath, fullPath });
    }

    if (validPaths.length === 0) {
      return { error: errors.join(', ') };
    }

    const names = validPaths
      .map((p) => {
        const name = path.basename(p.filePath);
        return fs.statSync(p.fullPath).isDirectory() ? `${name}/` : name;
      })
      .join(', ');
    const ok = await confirm(`Delete ${names}?`, { tool: 'deleteFile' });
    if (!ok) {
      return { error: 'User denied this action. Do not retry.' };
    }

    for (const { filePath, fullPath } of validPaths) {
      try {
        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();

        saveDelete(fullPath);

        if (isDir) {
          await fs.promises.rm(fullPath, { recursive: true });
        } else {
          await fs.promises.unlink(fullPath);
        }
        const name = path.basename(filePath);
        deleted.push(isDir ? `${name}/` : name);
      } catch {
        errors.push(`failed: ${filePath}`);
      }
    }

    if (deleted.length === 0) {
      return { error: errors.join(', ') };
    }

    const msg = `Deleted ${deleted.join(', ')}`;
    return {
      message: errors.length ? `${msg} (errors: ${errors.join(', ')})` : msg,
      silent: true,
    };
  },
});
