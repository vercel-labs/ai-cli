import { clearRules, listRules, removeRule } from '../../utils/permissions.js';
import type { CommandHandler } from './types.js';

export const permissions: CommandHandler = (_ctx, args) => {
  if (!args || args === 'list') {
    const rules = listRules();
    if (rules.length === 0) {
      return {
        output:
          'no permission rules\nuse "always" on a confirm prompt to add one',
      };
    }
    const lines = rules.map((r, i) => {
      const home = process.env.HOME || '';
      const dir =
        home && (r.directory === home || r.directory.startsWith(`${home}/`))
          ? `~${r.directory.slice(home.length)}`
          : r.directory;
      if (r.tool === 'runCommand' && r.command) {
        return `${i}: allow "${r.command}" in ${dir}`;
      }
      return `${i}: allow ${r.tool} in ${dir}`;
    });
    return { output: lines.join('\n') };
  }

  if (args === 'clear') {
    clearRules();
    return { output: 'all permission rules cleared' };
  }

  if (args.startsWith('remove ')) {
    const idx = Number.parseInt(args.slice(7).trim(), 10);
    if (Number.isNaN(idx)) {
      return { output: 'use: /permissions remove <index>' };
    }
    const ok = removeRule(idx);
    if (!ok) {
      return { output: `invalid index: ${idx}` };
    }
    return { output: `rule ${idx} removed` };
  }

  return { output: 'use: /permissions [list|remove <index>|clear]' };
};
