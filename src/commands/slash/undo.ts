import { dim } from 'yoctocolors';
import { canUndo, undo as performUndo, undoCount } from '../../utils/undo.js';
import type { CommandHandler } from './types.js';

export const undo: CommandHandler = () => {
  if (!canUndo()) {
    console.log(dim('nothing to undo\n'));
    return undefined;
  }

  const result = performUndo();
  if (result.success) {
    const remaining = undoCount();
    const suffix = remaining > 0 ? ` (${remaining} more)` : '';
    console.log(dim(`${result.message}${suffix}\n`));
  } else {
    console.log(dim(`failed: ${result.message}\n`));
  }

  return undefined;
};
