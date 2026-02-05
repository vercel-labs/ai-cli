import { tool } from 'ai';
import { z } from 'zod';
import { commands } from '../commands/slash/index.js';
import type { Context } from '../commands/slash/types.js';

let currentModel = 'anthropic/claude-sonnet-4.5';

export function setSlashModel(model: string) {
  currentModel = model;
}

export const slash = tool({
  description: 'Run a slash command. Use this for git operations instead of running git directly.',
  inputSchema: z.object({
    command: z.string().describe('The command without the slash, e.g. "git commit" or "git status"'),
  }),
  execute: async ({ command }) => {
    const parts = command.trim().split(' ');
    const cmd = parts[0];
    const args = parts.slice(1).join(' ');

    const blocked = ['list', 'chat', 'chats', 'clear', 'copy', 'compress', 'settings', 'alias', 'init', 'help', 'model'];

    if (cmd === 'git' && args?.startsWith('commit')) {
      return { error: 'tell user to run /git commit themselves' };
    }
    if (blocked.includes(cmd)) {
      return { error: `${cmd} is interactive, tell user to use /${cmd}` };
    }

    const handler = commands[cmd];
    if (!handler) {
      return { error: `unknown command: ${cmd}` };
    }

    const ctx: Context = {
      model: currentModel,
      version: '',
      chat: null,
      history: [],
      tokens: 0,
      cost: 0,
      rl: null as unknown as Context['rl'],
      createRl: () => null as unknown as Context['rl'],
      printHeader: () => {},
    };

    try {
      const result = await handler(ctx, args);
      return { output: result?.output || 'done' };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'command failed' };
    }
  },
});
