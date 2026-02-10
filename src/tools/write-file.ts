import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { green, red } from '../utils/color.js';
import { log as debug } from '../utils/debug.js';
import { pathError, safePath } from '../utils/safe-path.js';
import { saveWrite } from '../utils/undo.js';
import { confirm } from './confirm.js';

function writeDiff(oldContent: string | null, newContent: string): string {
  const PREVIEW = 5;
  const lines: string[] = [];

  if (oldContent !== null) {
    // Existing file – show removed / added (first N lines each)
    const oldLines = oldContent.split('\n').slice(0, PREVIEW);
    const newLines = newContent.split('\n').slice(0, PREVIEW);
    for (const l of oldLines) lines.push(red(`- ${l}`));
    for (const l of newLines) lines.push(green(`+ ${l}`));
    const more =
      Math.max(oldContent.split('\n').length, newContent.split('\n').length) -
      PREVIEW;
    if (more > 0) lines.push(`  ... ${more} more lines`);
  } else {
    // New file – show additions only
    const newLines = newContent.split('\n').slice(0, PREVIEW);
    for (const l of newLines) lines.push(green(`+ ${l}`));
    const more = newContent.split('\n').length - PREVIEW;
    if (more > 0) lines.push(`  ... ${more} more lines`);
  }

  return lines.join('\n');
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
      const fullPath = safePath(filePath);
      if (!fullPath) return { error: pathError(filePath) };

      const exists = fs.existsSync(fullPath);
      const verb = exists ? 'Update' : 'Create';
      const oldContent = exists ? fs.readFileSync(fullPath, 'utf-8') : null;
      const diff = writeDiff(oldContent, content);

      const ok = await confirm(`${verb} ${path.basename(filePath)}?\n${diff}`, {
        tool: 'writeFile',
      });
      if (!ok) {
        return { error: 'User denied this action. Do not retry.' };
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
