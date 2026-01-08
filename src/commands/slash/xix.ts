import { dim } from 'yoctocolors';
import type { CommandHandler } from './types.js';
import { toggle } from '../../utils/debug.js';

export const xix: CommandHandler = () => {
  const on = toggle();
  console.log(dim(`debug ${on ? 'on' : 'off'}\n`));
  return undefined;
};
