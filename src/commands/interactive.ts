import * as readline from 'node:readline/promises';
import { type ModelMessage, stepCountIs, streamText } from 'ai';
import { dim, gray } from 'yoctocolors';
import { getOrCreateChat, saveChat } from '../config/chats.js';
import { fileTools } from '../tools/index.js';
import { log as debug, isEnabled as isDebug } from '../utils/debug.js';
import { formatError } from '../utils/errors.js';
import {
  getContextWindow,
  shouldCompress,
  summarizeHistory,
} from '../utils/context.js';
import { detectPackageManager } from '../utils/package-manager.js';
import { killAllProcesses } from '../utils/processes.js';
import { createSpinner } from '../utils/spinner.js';
import { type Context, commands, restoreHistory } from './slash/index.js';

interface InteractiveOptions {
  model: string;
  version: string;
}

export async function interactiveCommand(
  options: InteractiveOptions,
): Promise<void> {
  let currentModel = options.model;
  const { version } = options;
  let currentChat: ReturnType<typeof getOrCreateChat> | null = null;
  const history: ModelMessage[] = [];
  let totalTokens = 0;
  let chatCost = 0;
  let sessionSummary = '';
  const packageManager = detectPackageManager();

  const createRl = () =>
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  let rl = createRl();

  const printHeader = () => {
    if (currentChat) {
      const title =
        currentChat.title.length > 30
          ? `${currentChat.title.slice(0, 30)}...`
          : currentChat.title;
      console.log(gray(`ai ${version} [${currentModel}] - ${title}`));
    } else {
      console.log(gray(`ai ${version} [${currentModel}]`));
    }
    console.log(dim('type /help for commands'));
  };

  printHeader();

  const cleanup = () => {
    killAllProcesses();
    console.log();
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);

  while (true) {
    let input: string;
    try {
      input = await rl.question('› ');
    } catch {
      cleanup();
      return;
    }

    const message = input.trim();

    if (!message) continue;

    if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
      cleanup();
      return;
    }

    if (message.startsWith('/')) {
      const parts = message.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      const handler = commands[cmd];
      if (!handler) {
        console.log(dim('unknown command. type /help\n'));
        continue;
      }

      const ctx: Context = {
        model: currentModel,
        version,
        chat: currentChat,
        history,
        tokens: totalTokens,
        cost: chatCost,
        rl,
        createRl,
        printHeader,
      };

      const result = await handler(ctx, args);

      if (result) {
        if (result.model) currentModel = result.model;
        if (result.chat) currentChat = result.chat;
        if (result.tokens !== undefined) totalTokens = result.tokens;
        if (result.cost !== undefined) chatCost = result.cost;
        if (result.rl) rl = result.rl;
        if (result.clearHistory) history.length = 0;
        if (result.summary) sessionSummary = result.summary;

        if (result.chat && cmd === 'chat' && currentChat) {
          sessionSummary = currentChat.summary || '';
          restoreHistory({ chat: currentChat }, history);
        }

        printHeader();
      }

      continue;
    }

    if (!currentChat) {
      currentChat = getOrCreateChat(currentModel);
    }

    debug(`input: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`);

    history.push({ role: 'user', content: message });
    currentChat.messages.push({ role: 'user', content: message });

    const spinner = createSpinner();
    let hasSeenContent = false;
    let reasoning = '';

    try {
      const contextWindow = await getContextWindow(currentModel);
      if (shouldCompress(totalTokens, contextWindow)) {
        spinner.start('compressing context...');
        const summary = await summarizeHistory(history);
        spinner.stop();

        if (summary) {
          sessionSummary = summary;
          history.length = 0;
          totalTokens = Math.round(summary.length / 4);
          currentChat.summary = summary;
          currentChat.messages = [];
          currentChat.tokens = totalTokens;
          saveChat(currentChat);
          console.log(dim('context compressed\n'));
        }
      }

      if (!isDebug()) spinner.start('thinking...');
      debug('stream start');

      const basePrompt = `You are a CLI assistant. Plain text only. No markdown. No emojis. Be concise.

Package manager: ${packageManager.pm} (run scripts with "${packageManager.run}")

Preferences:
- Always use TypeScript (not JavaScript) unless told otherwise
- For Next.js: use --ts flag, App Router, src directory

IMPORTANT: After using file/memory/command tools, output NOTHING. No "Done", no "Saved", no confirmation. Complete silence. The tools handle output.`;

      const systemPrompt = sessionSummary
        ? `${basePrompt}

Previous session context:
${sessionSummary}`
        : basePrompt;

      const result = streamText({
        model: currentModel,
        system: systemPrompt,
        messages: history,
        tools: fileTools,
        stopWhen: stepCountIs(5),
        providerOptions: {
          openai: {
            reasoningEffort: 'high',
            reasoningSummary: 'detailed',
          },
        },
        headers: {
          'HTTP-Referer': 'https://www.npmjs.com/package/ai-cli',
          'X-Title': 'ai-cli',
        },
      });

      let hasSilentTool = false;

      const toolActions: Record<string, string> = {
        readFile: 'reading...',
        writeFile: 'writing...',
        editFile: 'editing...',
        deleteFile: 'deleting...',
        copyFile: 'copying...',
        renameFile: 'renaming...',
        createFolder: 'creating...',
        listDirectory: 'listing...',
        findFiles: 'searching...',
        searchInFiles: 'searching...',
        fileInfo: 'checking...',
        runCommand: 'running...',
        startProcess: 'starting...',
        killProcess: 'stopping...',
        memory: 'remembering...',
      };

      for await (const part of result.fullStream) {
        if (hasSilentTool) continue;
        if (part.type === 'reasoning-delta' && part.text) {
          reasoning += part.text;
          spinner.update(reasoning);
        } else if (part.type === 'tool-call') {
          debug(`tool-call: ${part.toolName}`);
          const action = toolActions[part.toolName] || 'working...';
          spinner.update(action);
        } else if (part.type === 'tool-result') {
          debug('tool-result');
          const out = part.output as Record<string, unknown> | undefined;
          if (out?.silent === true) {
            hasSilentTool = true;
            spinner.stop();
          } else if (!isDebug()) {
            spinner.start('thinking...');
          }
        } else if (part.type === 'text-delta') {
          spinner.stop();
          if (!hasSeenContent) hasSeenContent = true;
          process.stdout.write(part.text);
        }
      }

      spinner.stop();
      if (hasSeenContent) {
        console.log();
      }
      debug('stream end');
      if (hasSeenContent || hasSilentTool) {
        console.log();
      }

      if (hasSilentTool) {
        const res = await result.response;
        for (const msg of res.messages) {
          if (msg.role === 'assistant' || msg.role === 'tool') {
            history.push(msg);
          }
        }
      } else {
        const res = await result.response;
        const usage = await result.usage;
        const metadata = await result.providerMetadata;
        if (usage?.totalTokens) {
          totalTokens += usage.totalTokens;
        }
        const gw = (metadata as Record<string, unknown>)?.gateway as
          | Record<string, unknown>
          | undefined;
        if (gw?.cost && typeof gw.cost === 'string') {
          chatCost += Number.parseFloat(gw.cost) || 0;
        }
        let assistantText = '';
        for (const msg of res.messages) {
          if (msg.role === 'assistant' || msg.role === 'tool') {
            history.push(msg);
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if (part.type === 'text') assistantText += part.text;
              }
            }
          }
        }
        if (assistantText) {
          currentChat.messages.push({
            role: 'assistant',
            content: assistantText,
          });
        }
      }
      if (
        currentChat.messages.length === 2 &&
        currentChat.title === 'New chat'
      ) {
        const firstMsg = currentChat.messages.find((m) => m.role === 'user');
        if (firstMsg) {
          currentChat.title = firstMsg.content.slice(0, 50).trim();
        }
      }
      currentChat.tokens = totalTokens;
      currentChat.cost = chatCost;
      saveChat(currentChat);
    } catch (error) {
      spinner.stop();
      console.error(formatError(error));
    }
  }
}
