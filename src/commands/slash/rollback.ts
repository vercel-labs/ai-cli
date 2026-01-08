import { canUndo, undoOne, undoCount, getStack, rollbackTo } from '../../utils/undo.js';
import type { CommandHandler } from './types.js';

export const rollback: CommandHandler = (_ctx, args) => {
  if (!canUndo()) {
    return { output: 'no changes to rollback' };
  }

  const arg = args?.trim();

  if (!arg) {
    const items = getStack();
    const lines = ['recent changes:'];
    for (const item of items.slice(0, 10)) {
      lines.push(`  ${item.index}. ${item.action} ${item.file} (${item.time})`);
    }
    if (items.length > 10) {
      lines.push(`  ... and ${items.length - 10} more`);
    }
    lines.push('\n/rollback <n> to undo to that point');
    lines.push('/rollback 1 to undo last change');
    return { output: lines.join('\n') };
  }

  const num = parseInt(arg, 10);
  if (isNaN(num) || num < 1) {
    return { output: 'usage: /rollback <number>' };
  }

  if (num === 1) {
    const result = undoOne();
    const remaining = undoCount();
    const suffix = remaining > 0 ? ` (${remaining} more)` : '';
    return { output: result.success ? `${result.message}${suffix}` : `failed: ${result.message}` };
  }

  const result = rollbackTo(num);
  return { output: result.success ? result.message : `failed: ${result.message}` };
};

