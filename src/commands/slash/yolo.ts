import { getSetting, setSetting } from '../../config/settings.js';
import type { CommandHandler } from './types.js';

export const yolo: CommandHandler = () => {
  const current = getSetting('yolo');
  setSetting('yolo', !current);
  return { output: `yolo mode ${!current ? 'on' : 'off'}` };
};
