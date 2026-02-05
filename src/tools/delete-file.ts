import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
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

    const names = paths.map(p => path.basename(p)).join(', ');
    const ok = await confirm(`delete ${names}?`);
    if (!ok) {
      return { message: 'cancelled', silent: true };
    }

    for (const filePath of paths) {
      try {
        const fullPath = path.resolve(filePath);

        if (!fs.existsSync(fullPath)) {
          errors.push(`not found: ${filePath}`);
          continue;
        }

        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();

        saveDelete(fullPath);

        if (isDir) {
          fs.rmSync(fullPath, { recursive: true });
        } else {
          fs.unlinkSync(fullPath);
        }
        deleted.push(filePath);
      } catch {
        errors.push(`failed: ${filePath}`);
      }
    }

    if (deleted.length === 0) {
      return { error: errors.join(', ') };
    }

    const msg = `deleted ${deleted.join(', ')}`;
    return { message: errors.length ? `${msg} (errors: ${errors.join(', ')})` : msg, silent: true };
  },
});
