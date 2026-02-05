import { getAliases } from '../../config/index.js';
import type { CommandHandler } from './types.js';

const details: Record<string, string> = {
  chat: `/chat
  /chat              list saved chats
  /chat <n>          load chat by number
  /chat <search>     search and load chat
  /chat new          start new chat
  /chat delete       delete current chat
  /chat delete all   delete all chats`,

  clear: `/clear
  clears current chat history without deleting it`,

  copy: `/copy
  copies last AI response to clipboard`,

  rollback: `/rollback
  /rollback          list recent file changes
  /rollback <n>      undo change by number`,

  diff: `/diff
  shows recent file changes made by AI`,

  compress: `/compress
  compresses chat history to save context space
  auto-triggers at 75% context usage`,

  usage: `/usage
  shows chat stats, context window usage, and cost
  also shows loaded rules files`,

  processes: `/processes
  /processes         list background processes
  /processes <pid>   kill process by id`,

  memory: `/memory
  /memory            list saved memories
  /memory clear      clear all memories
  use "remember X" to save facts`,

  settings: `/settings
  /settings                     show all settings
  /settings model <name>        default model
  /settings spacing <0-4>       line spacing
  /settings markdown on|off     render markdown
  /settings search parallel|perplexity
  /settings steps <1-50>        max tool steps`,

  image: `/image
  /image             paste image from clipboard
  /image <path>      attach image from file
  /image clear       remove attached image`,

  skills: `/skills
  /skills            list installed skills
  /skills add <url>  install skill
  /skills remove <n> uninstall skill
  /skills show <n>   view skill content
  /skills create <n> create new skill`,

  rules: `/rules
  /rules             show global rules
  /rules edit        open in editor
  /rules clear       remove rules`,

  model: `/model
  /model             interactive model selector
  /model <search>    search and switch model`,

  alias: `/alias
  /alias                  list aliases
  /alias <name> <cmd>     create alias
  /alias remove <name>    remove alias`,

  info: `/info
  shows version, current model, balance, storage, and feedback link`,
};

export const help: CommandHandler = (_ctx, args) => {
  const cmd = args?.trim().toLowerCase();

  if (cmd && details[cmd]) {
    return { output: details[cmd] };
  }

  if (cmd) {
    return { output: `no help for: ${cmd}` };
  }

  const lines = [
    'commands:',
    '  /chat        chats',
    '  /clear       clear chat',
    '  /copy        copy response',
    '  /image       attach image',
    '  /rollback    undo changes',
    '  /diff        view changes',
    '  /compress    compress history',
    '  /usage       stats',
    '  /processes   processes',
    '  /memory      memories',
    '  /skills      skills',
    '  /rules       rules',
    '  /settings    settings',
    '  /model       model',
    '  /alias       shortcuts',
    '  /info        info',
    '  exit         quit',
    '',
    '/help <cmd> for details',
  ];

  const aliases = getAliases();
  const keys = Object.keys(aliases);
  if (keys.length > 0) {
    lines.push('');
    lines.push('aliases:');
    for (const k of keys) {
      lines.push(`  /${k} → /${aliases[k]}`);
    }
  }

  return { output: lines.join('\n') };
};
