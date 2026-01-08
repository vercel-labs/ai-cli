import type { CommandHandler } from './types.js';
import { toggle } from '../../utils/debug.js';

export const xix: CommandHandler = () => {
  const on = toggle();
  return { output: `debug ${on ? 'on' : 'off'}` };
};
