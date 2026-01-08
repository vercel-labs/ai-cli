import { getContextWindow, loadContextFiles } from '../../utils/context.js';
import type { CommandHandler } from './types.js';

export const context: CommandHandler = async (ctx) => {
  try {
    const contextWindow = await getContextWindow(ctx.model);
    const pct = Math.round((ctx.tokens / contextWindow) * 100);
    const bar =
      '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    const lines = [
      `context: ${ctx.tokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`,
      `[${bar}] ${pct}%`,
      `messages: ${ctx.history.length}`,
    ];
    if (pct >= 75) {
      lines.push('auto-compress at 75%');
    }

    const files = loadContextFiles();
    if (files.length > 0) {
      lines.push('');
      lines.push('loaded context files:');
      for (const f of files) {
        lines.push(`  ${f.type}: ${f.path}`);
      }
    }

    return { output: lines.join('\n') };
  } catch {
    return { output: `tokens used: ~${ctx.tokens.toLocaleString()}` };
  }
};
