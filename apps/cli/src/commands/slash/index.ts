import { getAliases } from '../../config/index.js';
import { alias } from './alias.js';
import { chat, restoreHistory } from './chat.js';
import { clear } from './clear.js';
import { compress } from './compress.js';
import { copy } from './copy.js';
import { help } from './help.js';
import { info } from './info.js';
import { init } from './init.js';
import { mcp } from './mcp.js';
import { memory } from './memory.js';
import { model } from './model.js';
import { permissions } from './permissions.js';
import { plan } from './plan.js';
import { processes } from './processes.js';
import { review } from './review.js';
import { rollback } from './rollback.js';
import { rules } from './rules.js';
import { settings } from './settings.js';
import { skills } from './skills.js';
import { summary } from './summary.js';
import type { CommandHandler } from './types.js';
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
  settings,
  permissions,
  plan,
  review,
  rules,
  skills,
  mcp,
  alias,
  xix,
};

export function resolveCommand(cmd: string): string {
  const aliases = getAliases();
  return aliases[cmd] || cmd;
}

export function getCompletions(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];

  const input = line.slice(1);
  const parts = input.split(' ');

  if (parts.length === 1) {
    const cmdNames = Object.keys(commands).filter((c) => !c.includes('-'));
    const matches = cmdNames.filter((c) => c.startsWith(input));
    return [matches.map((m) => `/${m}`), line];
  }

  return [[], line];
}
