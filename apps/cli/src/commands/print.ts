import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModelMessage } from 'ai';
import type { Chat } from '../config/chats.js';
import { streamChat } from '../hooks/chat.js';
import type { StreamCallbacks, TokenUsage } from '../hooks/chat.js';
import { setForceMode } from '../tools/confirm.js';
import { gray } from '../utils/color.js';
import { formatError } from '../utils/errors.js';
import { getModelCapabilities } from '../utils/models.js';
import { detectPackageManager } from '../utils/package-manager.js';
import { createSpinner } from '../utils/spinner.js';

interface PrintOptions {
  message: string;
  model: string;
  image?: string;
  json?: boolean;
  force?: boolean;
  save?: boolean;
  system?: string;
  version: string;
}

interface HeadlessResult {
  output: string;
  model: string;
  tokens: number;
  cost: number;
  exitCode: number;
  chatId?: string;
}

const imageTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export async function printCommand(options: PrintOptions): Promise<void> {
  const {
    message,
    model,
    image,
    json = false,
    force = false,
    save = true,
    system,
    version,
  } = options;

  if (force) setForceMode(true);

  if (!json) {
    process.stderr.write(gray(`ai ${version} [${model}]\n`));
  }

  let pendingImage: { data: string; mimeType: string } | null = null;
  if (image) {
    const resolved = path.resolve(image);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`image not found: ${image}\n`);
      process.exit(1);
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeType = imageTypes[ext];
    if (!mimeType) {
      process.stderr.write('unsupported format. use: png, jpg, gif, webp\n');
      process.exit(1);
    }
    const buffer = fs.readFileSync(resolved);
    pendingImage = { data: buffer.toString('base64'), mimeType };
  }

  const pm = detectPackageManager();
  const capabilities = await getModelCapabilities(model);
  const spinner = !json ? createSpinner(process.stderr) : null;

  let tokens = 0;
  let cost = 0;
  let output = '';
  let stuck = false;

  const history: ModelMessage[] = [];

  const callbacks: StreamCallbacks = {
    onStatus: (status) => {
      if (!json && status) spinner?.update(status);
      if (!json && !status) spinner?.stop();
    },
    onPending: (text) => {
      // In text mode, stream assistant text to stdout as it arrives.
      // We track what we've already written to avoid duplicates.
      if (!json && text.length > output.length) {
        process.stdout.write(text.slice(output.length));
        output = text;
      }
    },
    onMessage: (type, content) => {
      if (type === 'assistant') {
        if (json) {
          output = content;
        } else if (content.length > output.length) {
          // Flush any remaining text not yet written by onPending
          process.stdout.write(content.slice(output.length));
          output = content;
        }
      } else if (type === 'info' && content.startsWith('Stopped:')) {
        stuck = true;
        if (!json) process.stderr.write(`${content}\n`);
      } else if (type === 'error') {
        if (!json) process.stderr.write(`${content}\n`);
      } else if (type === 'tool') {
        if (!json) process.stderr.write(`${content}\n`);
      }
    },
    onRecord: (type, content) => {
      if (type === 'assistant') {
        if (json) {
          output = content;
        } else if (content.length > output.length) {
          process.stdout.write(content.slice(output.length));
          output = content;
        }
      }
    },
    onReasoning: (text, _durationMs) => {
      if (!json) {
        const short = text.replace(/\s+/g, ' ').trim().slice(-80);
        spinner?.update(short);
      }
    },
    onTokens: (fn) => {
      tokens = fn(tokens);
    },
    onCost: (fn) => {
      cost = fn(cost);
    },
    onUsage: (_usage: TokenUsage) => {},
    onSummary: () => {},
    onBusy: () => {},
  };

  let chat: Chat | null = null;

  try {
    spinner?.start('thinking...');

    chat = await streamChat({
      model,
      message,
      history,
      chat: null,
      tokens: 0,
      summary: '',
      pm,
      callbacks,
      image: pendingImage,
      hasTools: capabilities.tools,
      planMode: false,
      appendSystem: system,
    });

    spinner?.stop();

    if (!json && output) {
      process.stdout.write('\n');
    }

    if (!save && chat) {
      const { deleteChat } = await import('../config/chats.js');
      deleteChat(chat.id);
    }
  } catch (error) {
    spinner?.stop();
    if (json) {
      const result: HeadlessResult = {
        output: '',
        model,
        tokens,
        cost,
        exitCode: 1,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stderr.write(`${formatError(error)}\n`);
    }
    process.exit(1);
  } finally {
    if (force) setForceMode(false);
  }

  if (json) {
    const result: HeadlessResult = {
      output,
      model,
      tokens,
      cost,
      exitCode: stuck ? 2 : 0,
      chatId: save && chat ? chat.id : undefined,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  process.exit(stuck ? 2 : 0);
}
