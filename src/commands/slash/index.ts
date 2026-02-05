import { getAliases } from '../../config/index.js';
import { alias } from './alias.js';
import { chat, restoreHistory } from './chat.js';
import { clear } from './clear.js';
import { compress } from './compress.js';
import { copy } from './copy.js';
import { diff } from './diff.js';
import { help } from './help.js';
import { info } from './info.js';
import { init } from './init.js';
import { logsFull } from './logs.js';
import { memory } from './memory.js';
import { model } from './model.js';
import { processes } from './processes.js';
import { rules } from './rules.js';
import { settings } from './settings.js';
import { skills } from './skills.js';
import { summary } from './summary.js';
import type { CommandHandler } from './types.js';
import { rollback } from './rollback.js';
import { usage } from './usage.js';
import { xix } from './xix.js';

export { restoreHistory };
export type { CommandHandler, CommandResult, Context } from './types.js';

export const commands: Record<string, CommandHandler> = {
  help,
  model,
  clear,
  chat,
  info,
  version: info,
  processes,
  init,
  compress,
  summary,
  usage,
  context: usage,
  memory,
  rollback,
  copy,
  diff,
  settings,
  rules,
  skills,
  alias,
  xix,
  'logs-full': logsFull,
  logs: logsFull,
};

export function resolveCommand(cmd: string): string {
  const aliases = getAliases();
  return aliases[cmd] || cmd;
}
