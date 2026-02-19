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

  compress: `/compress
  compresses chat history to save context space
  auto-triggers at 75% context usage`,

  usage: `/usage
  shows chat stats, context window usage, and cost
  also shows loaded rules files`,

  processes: `/processes
  /processes         list background processes (with URLs and exit status)
  /processes <pid>   kill process by id
  /processes logs    show recent output from last process
  /processes logs <pid>  show recent output from specific process
  /processes killall kill all running, clear exited
  /processes clear   remove exited processes from list`,

  memory: `/memory
  /memory            list saved memories
  /memory clear      clear all memories
  use "remember X" to save facts`,

  settings: `/settings
  /settings                     show all settings
  /settings model <name>        default model
  /settings spacing <0-4>       line spacing
  /settings markdown on|off     render markdown
  /settings search parallel|perplexity`,

  skills: `/skills
  /skills            list installed skills
  /skills add <url>  install skill
  /skills remove <n> uninstall skill
  /skills show <n>   view skill content
  /skills create <n> create new skill
  /skills path       show skills directory`,

  rules: `/rules
  /rules             show global rules
  /rules edit        open in editor
  /rules clear       remove rules
  /rules path        show rules file path`,

  model: `/model
  /model             interactive model selector
  /model <search>    search and switch model`,

  alias: `/alias
  /alias                  list aliases
  /alias <name> <cmd>     create alias
  /alias remove <name>    remove alias`,

  mcp: `/mcp
  /mcp                    list mcp servers
  /mcp add <name> <type> <target>
                          add server (stdio|http|sse)
  /mcp remove <name>      remove server
  /mcp reload             reconnect all servers
  /mcp get <name>         show server config`,

  permissions: `/permissions
  /permissions             list permission rules
  /permissions remove <n>  remove rule by index
  /permissions clear       clear all rules
  use "always" on a confirm prompt to add one`,

  plan: `/plan
  toggles plan mode on/off
  when on, the agent outputs a step-by-step plan before executing
  you can approve or reject the plan before any changes are made
  also available via --plan flag at startup`,

  review: `/review
  /review             show review status
  /review on          enable auto-review after changes
  /review off         disable auto-review
  a separate review agent checks all file changes for
  severe/high-priority bugs and fixes them automatically`,

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
    '  /rollback    undo changes',
    '  /compress    compress history',
    '  /usage       stats',
    '  /processes   processes',
    '  /memory      memories',
    '  /skills      skills',
    '  /rules       rules',
    '  /mcp         mcp servers',
    '  /settings    settings',
    '  /permissions permissions rules',
    '  /plan        plan before executing',
    '  /review      review loop',
    '  /model       model',
    '  /alias       shortcuts',
    '  /info        info',
    '  exit         quit',
    '',
    'ctrl+v to paste images',
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
