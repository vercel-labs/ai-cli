import { getAliases } from '../../config/index.js';
import type { CommandHandler } from './types.js';

export const help: CommandHandler = () => {
  const lines = [
    'commands:',
    '  /new              start a new chat',
    '  /chats            list saved chats',
    '  /chat <n>         load chat by number or search',
    '  /delete           delete current chat',
    '  /purge            delete all chats',
    '  /clear            clear current chat',
    '  /copy             copy last response to clipboard',
    '  /rollback         view/undo file changes',
    '  /diff             view recent file changes',
    '  /context          show context window usage',
    '  /compress         compress chat history',
    '  /usage            show current chat stats',
    '  /processes        manage background processes',
    '  /memory           view saved memories',
    '  /settings         configure preferences',
    '  /list             select model from list',
    '  /model            show current model',
    '  /storage          show storage info',
    '  /credits          show balance',
    '  /alias            manage command shortcuts',
    '  /yolo             toggle confirm prompts',
    '  /version          show version',
    '  /help             show this help',
    '  exit, quit        exit interactive mode',
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
