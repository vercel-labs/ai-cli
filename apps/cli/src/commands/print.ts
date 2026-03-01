import type { ModelMessage } from 'ai';
import { type Chat, saveChat } from '../config/chats.js';
import {
  getReviewEnabled,
  getReviewMaxIterations,
} from '../config/settings.js';
import type { StreamCallbacks, TokenUsage } from '../hooks/chat.js';
import { streamChat } from '../hooks/chat.js';
import { withForceMode } from '../tools/confirm.js';
import { gray } from '../utils/color.js';
import { formatError } from '../utils/errors.js';
import { loadImage, type PendingImage } from '../utils/image.js';
import { getModelCapabilities } from '../utils/models.js';
import { detectPackageManager } from '../utils/package-manager.js';
import { reviewLoop } from '../utils/review.js';
import { createSpinner } from '../utils/spinner.js';
import {
  getChangedFilesWithOriginals,
  hasChangedFiles,
} from '../utils/undo.js';

interface PrintOptions {
  message: string;
  model: string;
  image?: string;
  json?: boolean;
  force?: boolean;
  save?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  system?: string;
  plan?: boolean;
  resume?: string;
  timeout?: number;
  version: string;
}

type ChatMessage =
  | { role: 'assistant'; content: string }
  | { role: 'tool'; content: string }
  | { role: 'reasoning'; content: string }
  | { role: 'error'; content: string };

interface HeadlessResult {
  output: string;
  model: string;
  tokens: number;
  cost: number;
  steps: number;
  toolCalls: number;
  exitCode: number;
  chatId?: string;
  error?: string;
  usage?: TokenUsage;
  messages?: ChatMessage[];
}

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function exit(code: number): void {
  const waitDrain = (stream: NodeJS.WriteStream): Promise<void> =>
    new Promise((resolve) => {
      if (!stream.writableNeedDrain) {
        resolve();
        return;
      }
      stream.once('drain', resolve);
    });

  Promise.all([waitDrain(process.stdout), waitDrain(process.stderr)])
    .then(() => {
      // Give the kernel a tick to flush pipe buffers
      setTimeout(() => process.exit(code), 50).unref();
    })
    .catch(() => process.exit(code));

  setTimeout(() => process.exit(code), 2000).unref();
}

const MAX_TIMEOUT = 86400;

export async function printCommand(options: PrintOptions): Promise<void> {
  const { force = false } = options;
  const run = () => printCommandInner(options);
  return force ? withForceMode(run) : run();
}

async function printCommandInner(options: PrintOptions): Promise<void> {
  const {
    message,
    model,
    image,
    json = false,
    save = true,
    quiet = false,
    verbose: explicitVerbose,
    system,
    plan = false,
    resume,
    timeout,
    version,
  } = options;

  const verbose = explicitVerbose ?? (!json && !quiet);
  let exitCode = 0;

  try {
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
          steps: 0,
          toolCalls: 0,
          exitCode: 1,
          error: msg,
          chatId: opts?.chatId,
          usage: opts?.usage,
        };
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stderr.write(`error: ${msg}\n`);
      }
      throw new ExitError(1);
    }

    const timeoutSec = timeout !== undefined ? Math.floor(timeout) : undefined;

    if (
      timeoutSec !== undefined &&
      (Number.isNaN(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_TIMEOUT)
    ) {
      emitErrorAndExit(`timeout must be between 1 and ${MAX_TIMEOUT} seconds`);
    }

    if (!message && !resume) {
      emitErrorAndExit('no message provided');
    }

    if (verbose) {
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
    const useSpinner = verbose && !json;
    const spinner = useSpinner ? createSpinner(process.stderr) : null;

    let tokens = 0;
    let cost = 0;
    let steps = 0;
    let toolCalls = 0;
    let output = '';
    let outputEndsWithNewline = false;
    let stuck = false;
    let usage: TokenUsage | null = null;
    const messages: ChatMessage[] = [];

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

    const abortSignal = timeoutSec
      ? AbortSignal.timeout(timeoutSec * 1000)
      : undefined;

    // Incrementally write assistant output to stdout. The AI SDK reports
    // the full accumulated text on each callback, so we diff against what
    // we've already written. Three cases:
    //   1. Content grew from the previous value -- write only the new suffix.
    //   2. Content changed entirely -- write on a new line (or same line if
    //      the previous output already ended with a newline).
    //   3. Content is identical -- skip (no duplicate writes).
    // In JSON mode we just capture the final value without writing.
    const trackOutput = (content: string) => {
      if (!content) return;
      if (json) {
        output = content;
      } else if (content !== output) {
        if (output && content.startsWith(output)) {
          const chunk = content.slice(output.length);
          process.stdout.write(chunk);
          outputEndsWithNewline = chunk.endsWith('\n');
        } else if (output && !outputEndsWithNewline) {
          process.stdout.write(`\n${content}`);
          outputEndsWithNewline = content.endsWith('\n');
        } else {
          process.stdout.write(content);
          outputEndsWithNewline = content.endsWith('\n');
        }
        output = content;
      }
    };

    const logLine = (msg: string) => {
      if (verbose) process.stderr.write(`${msg}\n`);
    };

    const emitMsg = (role: ChatMessage['role'], content: string) => {
      messages.push({ role, content } as ChatMessage);
      if (json) {
        process.stderr.write(`[msg] ${JSON.stringify({ role, content })}\n`);
      }
    };

    const callbacks: StreamCallbacks = {
      onStatus: (status) => {
        if (spinner && status) spinner.update(status);
        if (spinner && !status) spinner.stop();
        if (!spinner && verbose && status) logLine(`[status] ${status}`);
      },
      onPending: (text) => {
        if (!text) {
          if (!json) {
            output = '';
            outputEndsWithNewline = false;
          }
          return;
        }
        trackOutput(text);
      },
      onMessage: (type, content) => {
        if (type === 'assistant') {
          trackOutput(content);
          if (json) emitMsg('assistant', content);
        } else if (type === 'info' && content.startsWith('Stopped:')) {
          stuck = true;
          logLine(content);
        } else if (type === 'error') {
          logLine(content);
          if (json) emitMsg('error', content);
        } else if (type === 'tool') {
          toolCalls++;
          logLine(content);
          if (json) emitMsg('tool', content);
        }
      },
      onRecord: (type, content) => {
        if (type === 'assistant') {
          trackOutput(content);
          if (json) emitMsg('assistant', content);
        }
      },
      onReasoning: (_text, _durationMs) => {
        if (spinner) {
          const short = _text.replace(/\s+/g, ' ').trim().slice(-80);
          spinner.update(short);
        } else if (verbose) {
          logLine(`[reasoning] ${_text}`);
        }
        if (json) emitMsg('reasoning', _text);
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
      onStepFinish: () => {
        steps++;
      },
    };

    let chat: Chat | null = null;

    try {
      if (verbose) logLine('[phase] coding agent');
      if (spinner) spinner.start('thinking...');

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

      if (hasChangedFiles() && getReviewEnabled()) {
        const changed = getChangedFilesWithOriginals();
        if (changed.length > 0) {
          if (verbose) logLine('[phase] review agent');
          spinner?.start('reviewing...');
          try {
            await reviewLoop({
              model,
              originalTask: message,
              changedFiles: changed,
              maxIterations: getReviewMaxIterations(),
              callbacks,
              abortSignal,
              pm,
              onPhase: verbose
                ? (label) => logLine(`[phase] ${label}`)
                : undefined,
            });
          } catch (e) {
            if ((e as Error).name !== 'AbortError') {
              if (verbose) {
                process.stderr.write(`review error: ${formatError(e)}\n`);
              }
            }
          }
          spinner?.stop();
        }
      }

      if (verbose) logLine('[phase] done');

      if (!json && output) {
        process.stdout.write('\n');
      }

      if (save && chat) {
        saveChat(chat);
      }
    } catch (error) {
      if (error instanceof ExitError) throw error;
      spinner?.stop();
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      if (isTimeout) {
        process.stderr.write(
          'warning: timed out during tool execution; workspace may contain partial changes\n' +
            'hint: run `git diff` to inspect changes, `git checkout .` to revert\n',
        );
      }
      const errorMsg = isTimeout
        ? `timed out after ${timeoutSec}s`
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
        steps,
        toolCalls,
        exitCode: stuck ? 2 : 0,
        chatId: save && chat ? chat.id : undefined,
        usage: usage ?? undefined,
        messages,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }

    exitCode = stuck ? 2 : 0;
  } catch (error) {
    if (error instanceof ExitError) {
      exitCode = error.code;
    } else {
      throw error;
    }
  }

  exit(exitCode);
}
