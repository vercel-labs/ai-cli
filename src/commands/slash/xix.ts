import { toggle } from '../../utils/debug.js';
import type { CommandHandler } from './types.js';

export const xix: CommandHandler = () => {
  const on = toggle();
  return { output: `debug ${on ? 'on' : 'off'}` };
};
