import { loadSettings, setSetting } from '../../config/settings.js';
import type { CommandHandler } from './types.js';

export const settings: CommandHandler = (_ctx, args) => {
  const current = loadSettings();

  if (!args) {
    const output = `settings:
  model:     ${current.model || '(default)'}
  search:    ${current.search || 'perplexity'}
  steps:     ${current.steps || 30}
  spacing:   ${current.spacing}
  markdown:  ${current.markdown ? 'on' : 'off'}

usage:
  /settings model <name>
  /settings search perplexity|parallel
  /settings steps <1-50>
  /settings spacing <0-4>
  /settings markdown on|off

for rules: /rules`;
    return { output };
  }

  const parts = args.split(' ');
  const key = parts[0];
  const value = parts.slice(1).join(' ');

  if (key === 'model') {
    if (!value) {
      return { output: 'use: /settings model <name>' };
    }
    setSetting('model', value);
    return { output: `default model set to ${value}` };
  }

  if (key === 'search') {
    if (value === 'perplexity' || value === 'parallel') {
      setSetting('search', value);
      return { output: `search provider set to ${value}` };
    }
    return { output: 'use: /settings search perplexity|parallel' };
  }

  if (key === 'steps') {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num < 1 || num > 50) {
      return { output: 'use: /settings steps <1-50>' };
    }
    setSetting('steps', num);
    return { output: `max steps set to ${num}` };
  }

  if (key === 'spacing') {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num < 0 || num > 4) {
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

  if (key === 'rules') {
    return { output: 'use /rules command instead' };
  }

  return { output: 'unknown setting' };
};
