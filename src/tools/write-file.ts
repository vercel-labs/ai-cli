import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { dim } from 'yoctocolors';
import { z } from 'zod';
import { log as debug } from '../utils/debug.js';
import { saveWrite } from '../utils/undo.js';

function fileLink(fullPath: string, name: string): string {
  return `\x1b]8;;file://${fullPath}\x1b\\${name}\x1b]8;;\x1b\\`;
}

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
      const fullPath = path.resolve(filePath);

      const exists = fs.existsSync(fullPath);
      saveWrite(fullPath);

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf-8');

      const link = fileLink(fullPath, filePath);
      const verb = exists ? 'updated' : 'created';
      process.stdout.write(`\r\x1b[K${dim(`done. ${verb} ${link}`)}\n`);

      return { success: true, silent: true };
    } catch (e) {
      return { error: `Failed to write file: ${(e as Error).message}` };
    }
  },
});
