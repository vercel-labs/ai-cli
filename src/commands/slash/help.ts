import { dim } from 'yoctocolors';
import type { CommandHandler } from './types.js';

export const help: CommandHandler = () => {
  console.log(
    dim(`
commands:
  /new          start a new chat
  /chats        list saved chats
  /chat <n>     load chat by number or search
  /delete       delete current chat
  /purge        delete all chats
  /storage      show storage info
  /context      show context window usage
  /compress     compress chat history
  /summary      view compressed summary
  /usage        show current chat stats
  /processes    manage background processes
  /memory       view saved memories
  /undo, /u     undo last file change
  /list, /l     select model from list
  /model, /m    show current model
  /clear, /c    clear current chat
  /credits      show balance
  /init, /i     setup api key
  /help, /h     show this help
  exit, quit    exit interactive mode
`),
  );
  return undefined;
};
