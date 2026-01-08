import { loadSettings, setSetting } from '../../config/settings.js';
import type { CommandHandler } from './types.js';

export const settings: CommandHandler = (_ctx, args) => {
  const current = loadSettings();

  if (!args) {
    const output = `settings:
  spacing:  ${current.spacing}
  markdown: ${current.markdown ? 'on' : 'off'}

usage:
  /settings spacing <0-4>
  /settings markdown on|off`;
    return { output };
  }

  const parts = args.split(' ');
  const key = parts[0];
  const value = parts[1];

  if (key === 'spacing') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 4) {
      return { output: 'use: /settings spacing <0-4>' };
    }
    setSetting('spacing', num);
    return { output: `spacing set to ${num}` };
  }

  if (key === 'markdown') {
    if (value === 'on' || value === 'true') {
      setSetting('markdown', true);
      return { output: 'markdown enabled' };
    } else if (value === 'off' || value === 'false') {
      setSetting('markdown', false);
      return { output: 'markdown disabled' };
    } else {
      return { output: 'use: /settings markdown on|off' };
    }
  }

  return { output: 'unknown setting. available: spacing, markdown' };
};
