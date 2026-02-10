import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { pathError, safePath } from '../utils/safe-path.js';
import { saveWrite } from '../utils/undo.js';
import { confirm } from './confirm.js';

export const writeFile = tool({
  description:
    'Write or create a file with the given content. Use this to help users create or modify files.',
  inputSchema: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    content: z.string().describe('Content to write to the file'),
  }),
  execute: async ({ filePath, content }) => {
    debug(`writeFile: ${filePath} (${content.length} chars)`);
    try {
      const fullPath = safePath(filePath);
      if (!fullPath) return { error: pathError(filePath) };

      const exists = fs.existsSync(fullPath);
      const verb = exists ? 'update' : 'create';

      const ok = await confirm(`${verb} ${filePath}?`);
      if (!ok) {
        return { message: 'cancelled', silent: true };
      }

      saveWrite(fullPath);

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf-8');

      return { message: `${verb}d ${filePath}`, silent: true };
    } catch {
      return { error: `write failed: ${filePath}` };
    }
  },
});
