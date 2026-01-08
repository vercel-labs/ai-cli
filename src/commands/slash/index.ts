import { getAliases } from '../../config/index.js';
import { alias } from './alias.js';
import { chat, restoreHistory } from './chat.js';
import { chats } from './chats.js';
import { clear } from './clear.js';
import { compress } from './compress.js';
import { context } from './context.js';
import { copy } from './copy.js';
import { credits } from './credits.js';
import { deleteCmd } from './delete.js';
import { diff } from './diff.js';
import { help } from './help.js';
import { init } from './init.js';
import { list } from './list.js';
import { memory } from './memory.js';
import { model } from './model.js';
import { newChat } from './new.js';
import { processes } from './processes.js';
import { purge } from './purge.js';
import { settings } from './settings.js';
import { storage } from './storage.js';
import { summary } from './summary.js';
import type { CommandHandler } from './types.js';
import { rollback } from './rollback.js';
import { usage } from './usage.js';
import { version } from './version.js';
import { xix } from './xix.js';
import { yolo } from './yolo.js';

export { restoreHistory };
export type { CommandHandler, CommandResult, Context } from './types.js';

export const commands: Record<string, CommandHandler> = {
  help,
  model,
  list,
  clear,
  new: newChat,
  chats,
  chat,
  delete: deleteCmd,
  purge,
  storage,
  processes,
  init,
  credits,
  context,
  compress,
  summary,
  usage,
  memory,
  rollback,
  copy,
  diff,
  settings,
  alias,
  version,
  xix,
  yolo,
};

export function resolveCommand(cmd: string): string {
  const aliases = getAliases();
  return aliases[cmd] || cmd;
}
