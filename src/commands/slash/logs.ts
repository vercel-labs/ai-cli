import type { Context, CommandResult } from './types.js';
import { getErrors, clearErrors, formatFullError } from '../../utils/errorlog.js';

export async function logsFull(_ctx: Context, args: string): Promise<CommandResult> {
  if (args === 'clear') {
    clearErrors();
    return { output: 'logs cleared' };
  }

  const errors = getErrors();
  if (errors.length === 0) {
    return { output: 'no errors logged' };
  }

  const output = errors
    .map((e, i) => {
      const time = e.time.toLocaleTimeString();
      return `[${i + 1}] ${time}\n${formatFullError(e.error)}`;
    })
    .join('\n\n---\n\n');

  return { output };
}
