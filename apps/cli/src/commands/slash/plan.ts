import type { CommandHandler } from './types.js';

export const plan: CommandHandler = () => {
  return { planMode: true };
};
