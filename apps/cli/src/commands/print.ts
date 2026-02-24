import type { ModelMessage } from 'ai';
import { type Chat, saveChat } from '../config/chats.js';
import { streamChat } from '../hooks/chat.js';
import type { StreamCallbacks, TokenUsage } from '../hooks/chat.js';
import { setForceMode } from '../tools/confirm.js';
import { gray } from '../utils/color.js';
import { formatError } from '../utils/errors.js';
import { loadImage, type PendingImage } from '../utils/image.js';
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
  plan?: boolean;
  resume?: string;
  timeout?: number;
  version: string;
}

interface HeadlessResult {
  output: string;
  model: string;
  tokens: number;
  cost: number;
  exitCode: number;
  chatId?: string;
  error?: string;
  usage?: TokenUsage;
}

function exit(code: number): void {
  const needsDrain =
    process.stdout.writableNeedDrain || process.stderr.writableNeedDrain;
  if (!needsDrain) {
    process.exit(code);
    return;
  }
  let remaining = 0;
  const done = () => {
    if (--remaining === 0) process.exit(code);
  };
  setTimeout(() => process.exit(code), 1000).unref();
  if (process.stdout.writableNeedDrain) {
    remaining++;
    process.stdout.once('drain', done);
  }
  if (process.stderr.writableNeedDrain) {
    remaining++;
    process.stderr.once('drain', done);
  }
}

export async function printCommand(options: PrintOptions): Promise<void> {
  const {
    message,
    model,
    image,
    json = false,
    force = false,
    save = true,
    system,
    plan = false,
    resume,
    timeout,
    version,
  } = options;

  if (force) setForceMode(true);

  function emitErrorAndExit(
    msg: string,
    opts?: {
      tokens?: number;
      cost?: number;
      usage?: TokenUsage;
      chatId?: string;
    },
  ): never {
    if (json) {
      const result: HeadlessResult = {
        output: '',
        model,
        tokens: opts?.tokens ?? 0,
        cost: opts?.cost ?? 0,
        exitCode: 1,
        error: msg,
        chatId: opts?.chatId,
        usage: opts?.usage,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stderr.write(`error: ${msg}\n`);
    }
    exit(1);
    throw new Error('unreachable');
  }

  if (timeout !== undefined && (Number.isNaN(timeout) || timeout <= 0)) {
    emitErrorAndExit('timeout must be a positive number of seconds');
  }

  if (!message && !resume) {
    emitErrorAndExit('no message provided');
  }

  if (!json) {
    process.stderr.write(gray(`ai ${version} [${model}]\n`));
  }

  let pendingImage: PendingImage | null = null;
  if (image) {
    try {
      pendingImage = loadImage(image);
    } catch (e) {
      emitErrorAndExit(e instanceof Error ? e.message : String(e));
    }
  }

  const pm = detectPackageManager();
  const capabilities = await getModelCapabilities(model);
  const spinner = !json ? createSpinner(process.stderr) : null;

  let tokens = 0;
  let cost = 0;
  let output = '';
  let stuck = false;
  let usage: TokenUsage | null = null;

  const history: ModelMessage[] = [];
  let existingChat: Chat | null = null;
  let initialTokens = 0;
  let summary = '';

  if (resume) {
    const { loadChat } = await import('../config/chats.js');
    const loaded = loadChat(resume);
    if (!loaded) {
      emitErrorAndExit(`session ${resume} not found`);
    }
    existingChat = loaded;
    summary = loaded.summary || '';
    initialTokens = loaded.tokens || 0;
    const { restoreHistory } = await import('./slash/chat.js');
    restoreHistory({ chat: loaded }, history);
  }

  const abortSignal = timeout ? AbortSignal.timeout(timeout * 1000) : undefined;

  const trackOutput = (content: string) => {
    if (!content) return;
    if (json) {
      output = content;
    } else if (content !== output) {
      if (output && content.startsWith(output)) {
        process.stdout.write(content.slice(output.length));
      } else if (output) {
        process.stdout.write(`\n${content}`);
      } else {
        process.stdout.write(content);
      }
      output = content;
    }
  };

  const callbacks: StreamCallbacks = {
    onStatus: (status) => {
      if (!json && status) spinner?.update(status);
      if (!json && !status) spinner?.stop();
    },
    onPending: (text) => {
      if (!text) {
        output = '';
        return;
      }
      trackOutput(text);
    },
    onMessage: (type, content) => {
      if (type === 'assistant') {
        trackOutput(content);
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
        trackOutput(content);
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
    onUsage: (u: TokenUsage) => {
      usage = u;
    },
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
      chat: existingChat,
      tokens: initialTokens,
      summary,
      pm,
      callbacks,
      image: pendingImage,
      hasTools: capabilities.tools,
      planMode: plan,
      appendSystem: system,
      abortSignal,
      save,
    });

    spinner?.stop();

    if (!json && output) {
      process.stdout.write('\n');
    }

    if (save && chat) {
      saveChat(chat);
    }
  } catch (error) {
    spinner?.stop();
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (isTimeout) {
      process.stderr.write(
        'warning: workspace may contain partial changes from interrupted tool execution\n',
      );
    }
    const errorMsg = isTimeout
      ? `timed out after ${timeout}s`
      : formatError(error);
    emitErrorAndExit(errorMsg, {
      tokens,
      cost,
      usage: usage ?? undefined,
      chatId: existingChat?.id,
    });
  }

  if (json) {
    const result: HeadlessResult = {
      output,
      model,
      tokens,
      cost,
      exitCode: stuck ? 2 : 0,
      chatId: save && chat ? chat.id : undefined,
      usage: usage ?? undefined,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  exit(stuck ? 2 : 0);
}
