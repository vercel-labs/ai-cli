import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { green, red } from '../utils/color.js';
import { log as debug } from '../utils/debug.js';
import { resolveAnyPath, safePath } from '../utils/safe-path.js';
import { saveWrite } from '../utils/undo.js';
import { confirm } from './confirm.js';

function shortDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n').slice(0, 5);
  const newLines = newText.split('\n').slice(0, 5);
  const lines: string[] = [];
  for (const line of oldLines) lines.push(red(`- ${line}`));
  for (const line of newLines) lines.push(green(`+ ${line}`));
  const more =
    Math.max(oldText.split('\n').length, newText.split('\n').length) - 5;
  if (more > 0) lines.push(`  ... ${more} more lines`);
  return lines.join('\n');
}

export const editFile = tool({
  description:
    'Edit a file by replacing old text with new text. Much faster than writeFile for small changes. The tool reads the file, so you dont need to read it first.',
  inputSchema: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    oldText: z
      .string()
      .describe('Exact text to find (include 2-3 lines of context)'),
    newText: z.string().describe('Text to replace it with'),
  }),
  execute: async ({ filePath, oldText, newText }) => {
    debug(`editFile: ${filePath}`);
    try {
      let fullPath = safePath(filePath);
      if (!fullPath) {
        const allowed = await confirm(
          `edit file outside project: ${filePath}`,
          { tool: 'editFile', noAlways: true },
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

      const content = fs.readFileSync(fullPath, 'utf-8');

      if (!content.includes(oldText)) {
        const lines = content.split('\n');
        const preview = lines.slice(0, 40).join('\n');
        const truncated =
          lines.length > 40 ? `\n... (${lines.length - 40} more lines)` : '';
        return {
          error: `text not found in ${filePath}. Read the file first to see the exact content. Here are the first 40 lines:\n${preview}${truncated}`,
        };
      }

      const diff = shortDiff(oldText, newText);
      const ok = await confirm(`Edit ${path.basename(filePath)}?\n${diff}`, {
        tool: 'editFile',
      });
      if (!ok) {
        return { error: 'User denied this action. Do not retry.' };
      }

      saveWrite(fullPath);
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(fullPath, updated, 'utf-8');

      const indentedDiff = diff
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n');
      return {
        message: `Edited ${filePath}\n${indentedDiff}`,
        silent: true,
      };
    } catch {
      return { error: `edit failed: ${filePath}` };
    }
  },
});
