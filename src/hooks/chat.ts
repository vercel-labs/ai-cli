import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type ModelMessage,
  type SystemModelMessage,
  stepCountIs,
  streamText,
} from 'ai';
import { type Chat, getOrCreateChat, saveChat } from '../config/chats.js';
import { getSetting } from '../config/settings.js';
import { getTools, loadMcpTools } from '../tools/index.js';
import { AI_CLI_HEADERS } from '../utils/constants.js';
import {
  getContextWindow,
  shouldCompress,
  summarizeHistory,
} from '../utils/context.js';
import { log as debug } from '../utils/debug.js';
import { logError } from '../utils/errorlog.js';
import { buildSystemPrompt, toolActions } from '../utils/prompt.js';
import { getStopReason, smartStop } from '../utils/stop-condition.js';

let sdkLogStream: fs.WriteStream | null = null;

function sdkLog(event: string, data?: unknown): void {
  if (!process.env.AI_SDK_DEBUG) return;
  if (!sdkLogStream) {
    const dir = path.join(os.homedir(), '.ai-sdk');
    fs.mkdirSync(dir, { recursive: true });
    sdkLogStream = fs.createWriteStream(path.join(dir, 'stream.log'), {
      flags: 'a',
    });
    sdkLogStream.write(`\n--- session ${new Date().toISOString()} ---\n`);
  }
  const ts = new Date().toISOString();
  const payload = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  sdkLogStream.write(`${ts} ${event}${payload}\n`);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

interface StreamCallbacks {
  onStatus: (status: string) => void;
  onPending: (text: string) => void;
  onMessage: (
    type: 'info' | 'tool' | 'assistant' | 'error',
    content: string,
  ) => void;
  /** Record a message in the history without rendering it. */
  onRecord: (
    type: 'info' | 'tool' | 'assistant' | 'error',
    content: string,
  ) => void;
  onReasoning: (text: string, durationMs: number) => void;
  /** Stream edit diff lines as the model generates tool args. */
  onEditStream?: (
    filePath: string,
    oldLines: string[],
    newLines: string[],
    more: number,
  ) => void;
  onTokens: (fn: (t: number) => number) => void;
  onCost: (fn: (c: number) => number) => void;
  onUsage?: (usage: TokenUsage) => void;
  onSummary: (summary: string) => void;
  onBusy: (busy: boolean) => void;
}

function extractJsonStringValue(
  text: string,
  key: string,
): { value: string; complete: boolean } | null {
  const marker = `"${key}":"`;
  const idx = text.indexOf(marker);
  if (idx < 0) return null;

  const start = idx + marker.length;
  let value = '';
  let escaped = false;
  let complete = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      switch (ch) {
        case 'n':
          value += '\n';
          break;
        case 't':
          value += '\t';
          break;
        case '"':
          value += '"';
          break;
        case '\\':
          value += '\\';
          break;
        case 'r':
          value += '\r';
          break;
        case 'u': {
          const hex = text.slice(i + 1, i + 5);
          if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
            value += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            value += 'u'; // incomplete, keep raw
          }
          break;
        }
        default:
          value += ch;
      }
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      complete = true;
      break;
    } else {
      value += ch;
    }
  }

  return { value, complete };
}

interface PendingImage {
  data: string;
  mimeType: string;
}

interface StreamOptions {
  model: string;
  message: string;
  history: ModelMessage[];
  chat: Chat | null;
  tokens: number;
  summary: string;
  pm: { pm: string; run: string };
  callbacks: StreamCallbacks;
  abortSignal?: AbortSignal;
  image?: PendingImage | null;
  hasTools?: boolean;
}

interface ToolInput {
  query?: string;
  objective?: string;
  command?: string;
  directory?: string;
  dirPath?: string;
  filePath?: string;
  paths?: string[];
}

interface ToolOutput {
  tree?: string;
  results?: unknown[] | string;
  output?: string;
  answer?: string;
  message?: string;
  content?: string;
  silent?: boolean;
  error?: string;
}

interface GatewayMeta {
  cost?: string;
}

interface ProviderMeta {
  gateway?: GatewayMeta;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
};

function isAnthropicModel(model: string): boolean {
  return model.startsWith('anthropic/');
}

function buildSystemParam(
  sys: string,
  model: string,
): string | SystemModelMessage {
  if (!isAnthropicModel(model)) return sys;
  return {
    role: 'system' as const,
    content: sys,
    providerOptions: ANTHROPIC_CACHE_CONTROL,
  };
}

/**
 * Add an ephemeral cache-control breakpoint to the last message in
 * history so Anthropic can cache the conversation prefix.
 * Mutates the array in place; call removeHistoryCacheBreakpoint()
 * afterwards to clean up.
 */
function addHistoryCacheBreakpoint(
  history: ModelMessage[],
  model: string,
): void {
  if (!isAnthropicModel(model) || history.length === 0) return;
  const last = history[history.length - 1];
  if (last.role === 'user' || last.role === 'assistant') {
    (last as { providerOptions?: Record<string, unknown> }).providerOptions = {
      ...last.providerOptions,
      ...ANTHROPIC_CACHE_CONTROL,
    };
  }
}

function removeHistoryCacheBreakpoint(
  history: ModelMessage[],
  model: string,
): void {
  if (!isAnthropicModel(model) || history.length === 0) return;
  const last = history[history.length - 1];
  if (
    last.providerOptions &&
    'anthropic' in last.providerOptions &&
    (last.providerOptions as Record<string, unknown>).anthropic ===
      ANTHROPIC_CACHE_CONTROL.anthropic
  ) {
    const { anthropic: _, ...rest } = last.providerOptions as Record<
      string,
      unknown
    >;
    (last as { providerOptions?: Record<string, unknown> }).providerOptions =
      Object.keys(rest).length > 0 ? rest : undefined;
  }
}

interface UsageResult {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
  };
}

function extractTokenUsage(u: UsageResult): TokenUsage {
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: u.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

let spacingSequenceTurn = 0;

export async function streamChat(options: StreamOptions): Promise<Chat> {
  const { model, message, history, tokens, summary, pm, callbacks } = options;
  const chat = options.chat ?? getOrCreateChat(model);

  if (process.env.AI_CLI_TEST_SCENARIO === 'spacing-running') {
    callbacks.onBusy(true);
    callbacks.onStatus('thinking...');
    callbacks.onPending('');
    await sleep(40);
    callbacks.onStatus('Running cd blog && npm install');
    await sleep(200);
    callbacks.onStatus('');
    callbacks.onMessage('tool', '$ cd blog && npm install\ninstalled');
    callbacks.onBusy(false);
    callbacks.onStatus('');
    chat.messages.push({ role: 'user', content: message });
    return chat;
  }

  if (process.env.AI_CLI_TEST_SCENARIO === 'spacing-leading-newlines') {
    callbacks.onBusy(true);
    callbacks.onStatus('thinking...');
    callbacks.onPending('');
    await sleep(40);
    callbacks.onStatus('');
    const text =
      '\n\n\nThere is no node_modules directory visible in the project.';
    callbacks.onPending(text);
    callbacks.onRecord('assistant', text);
    callbacks.onBusy(false);
    callbacks.onStatus('');
    chat.messages.push({ role: 'user', content: message });
    return chat;
  }

  if (process.env.AI_CLI_TEST_SCENARIO === 'spacing-sequence') {
    callbacks.onBusy(true);
    callbacks.onStatus('thinking...');
    callbacks.onPending('');
    await sleep(30);
    callbacks.onStatus('');

    if (spacingSequenceTurn === 0) {
      callbacks.onMessage('error', 'not found: blog/node_modules');
      callbacks.onMessage(
        'assistant',
        'No node_modules directory found in the blog folder.',
      );
    } else {
      callbacks.onStatus('Running cd blog && npm install');
      await sleep(180);
      callbacks.onStatus('');
      callbacks.onMessage('tool', '$ cd blog && npm install\ninstalled');
    }

    spacingSequenceTurn += 1;
    callbacks.onBusy(false);
    callbacks.onStatus('');
    chat.messages.push({ role: 'user', content: message });
    return chat;
  }

  debug(`input: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`);
  const historyLen = history.length;

  callbacks.onBusy(true);
  callbacks.onStatus('thinking...');
  callbacks.onPending('');

  const ctxWindow = await getContextWindow(model);
  if (shouldCompress(tokens, ctxWindow)) {
    callbacks.onStatus('compressing...');
    const s = await summarizeHistory(history);
    if (s) {
      callbacks.onSummary(s);
      history.length = 0;
      callbacks.onTokens(() => Math.round(s.length / 4));
      chat.summary = s;
      chat.messages = [];
      chat.tokens = Math.round(s.length / 4);
      saveChat(chat);
      callbacks.onMessage('info', 'context compressed');
    }
  }

  callbacks.onStatus('thinking...');

  const sys = buildSystemPrompt(pm, summary, message);

  type UserContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; image: string; mimeType: string };
  const userContent: UserContentPart[] = [{ type: 'text', text: message }];
  if (options.image) {
    userContent.unshift({
      type: 'image',
      image: options.image.data,
      mimeType: options.image.mimeType,
    });
  }
  history.push({
    role: 'user',
    content: options.image ? userContent : message,
  });

  const steps = getSetting('steps') || 30;
  const useTools = options.hasTools !== false;

  let silent = false;
  let buffer = '';
  let reasoning = '';
  let reasoningStart = 0;
  let currentToolLabel = '';
  let editStreamArgs = '';
  let editStreamActive = false;
  let editStreamLastCount = 0;
  let streamError: Error | null = null;
  let lastFinishReason = '';
  let searchResults: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    excerpt?: string;
  }> | null = null;
  let fetchContent: string | null = null;

  // Add cache breakpoint on the last history message before the new user
  // message so the conversation prefix can be cached by Anthropic.
  addHistoryCacheBreakpoint(history, model);

  const result = await (async () => {
    try {
      const mcpTools = useTools ? await loadMcpTools() : {};
      return streamText({
        model,
        system: buildSystemParam(sys, model),
        messages: history,
        tools: useTools ? getTools(mcpTools) : undefined,
        stopWhen: smartStop(steps),
        providerOptions: {
          openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' },
        },
        headers: AI_CLI_HEADERS,
        abortSignal: options.abortSignal,
        // Suppress the SDK's default onError which console.error's the
        // full error object.  We handle errors in our own stream loop
        // and format them with formatError() for a clean user message.
        onError: () => {},
      });
    } catch (e) {
      history.length = historyLen;
      throw e;
    }
  })();

  // Clean up the cache breakpoint so it doesn't leak into persisted history.
  removeHistoryCacheBreakpoint(history, model);

  const flushReasoning = () => {
    if (reasoning && reasoningStart) {
      callbacks.onReasoning(reasoning, Date.now() - reasoningStart);
      reasoning = '';
      reasoningStart = 0;
    }
  };

  try {
    for await (const part of result.fullStream) {
      const partType = part.type as string;
      sdkLog(partType, part);

      // Reset silent at the start of each new step so text from the model
      // in subsequent steps is displayed (e.g. clarifying questions after
      // tool calls).  Also flush the text buffer so new-step text doesn't
      // include text that was already streamed in a prior step.
      if (partType === 'start-step') {
        if (buffer) {
          callbacks.onRecord('assistant', buffer);
          callbacks.onPending('');
          buffer = '';
        }
        silent = false;
      }

      // When a previous tool set silent, skip text / reasoning but keep
      // processing tool events so errors and subsequent results are handled.
      if (
        silent &&
        partType !== 'tool-call' &&
        partType !== 'tool-result' &&
        partType !== 'tool-error' &&
        partType !== 'step-finish'
      ) {
        continue;
      }

      switch (partType) {
        case 'error': {
          const errorPart = part as { error?: Error };
          streamError = errorPart.error ?? new Error('unknown error');
          break;
        }

        case 'tool-error': {
          debug(`tool error: ${JSON.stringify(part)}`);
          const toolErr = part as { error?: unknown };
          if (toolErr.error) logError(toolErr.error);
          editStreamActive = false;
          callbacks.onStatus('thinking...');
          break;
        }

        case 'reasoning-delta': {
          const rp = part as { text?: string };
          if (rp.text) {
            if (!reasoningStart) reasoningStart = Date.now();
            reasoning += rp.text;
            callbacks.onStatus(
              reasoning.replace(/\s+/g, ' ').trim().slice(-80),
            );
          }
          break;
        }

        case 'tool-input-start': {
          const tcs = part as unknown as { toolName: string };
          if (tcs.toolName === 'editFile' && callbacks.onEditStream) {
            flushReasoning();
            editStreamActive = true;
            editStreamArgs = '';
            editStreamLastCount = 0;
            callbacks.onStatus('Editing...');
          } else {
            editStreamActive = false;
          }
          break;
        }

        case 'tool-input-delta': {
          if (editStreamActive && callbacks.onEditStream) {
            const tcd = part as unknown as { delta: string };
            editStreamArgs += tcd.delta;

            const fp = extractJsonStringValue(editStreamArgs, 'filePath');
            if (fp) {
              const old = extractJsonStringValue(editStreamArgs, 'oldText');
              const new_ = extractJsonStringValue(editStreamArgs, 'newText');

              const oldLines = old ? old.value.split('\n').slice(0, 5) : [];
              const newLines = new_ ? new_.value.split('\n').slice(0, 5) : [];
              const totalCount = oldLines.length + newLines.length;

              if (totalCount > editStreamLastCount) {
                editStreamLastCount = totalCount;
                const totalOld = old ? old.value.split('\n').length : 0;
                const totalNew = new_ ? new_.value.split('\n').length : 0;
                const more = Math.max(totalOld, totalNew) - 5;

                callbacks.onEditStream(
                  fp.value,
                  oldLines,
                  newLines,
                  more > 0 ? more : 0,
                );
              }
            }
          }
          break;
        }

        case 'tool-call': {
          flushReasoning();
          const tc = part as {
            toolName: string;
            input?: ToolInput;
          };
          debug(`tool-call: ${tc.toolName}`);
          const input = tc.input;
          let status: string;
          const wasEditStreamed =
            editStreamActive && tc.toolName === 'editFile';
          if (wasEditStreamed) editStreamActive = false;

          if (tc.toolName === 'listDirectory') {
            const p = input?.dirPath || '.';
            status = `Listing ${p}`;
            currentToolLabel = `Listed ${p}`;
          } else if (tc.toolName === 'readFile') {
            const f = input?.filePath || 'file';
            status = `Reading ${f}`;
            currentToolLabel = `Read ${f}`;
          } else if (tc.toolName === 'runCommand' && input?.command) {
            status = `Running ${input.command.slice(0, 70)}`;
            currentToolLabel = '';
          } else if (tc.toolName === 'writeFile') {
            const f = input?.filePath || 'file';
            status = `Writing ${f}`;
            currentToolLabel = '';
          } else if (tc.toolName === 'editFile') {
            const f = input?.filePath || 'file';
            status = `Editing ${f}`;
            currentToolLabel = '';
          } else if (tc.toolName === 'deleteFile') {
            status = 'Deleting';
            currentToolLabel = '';
          } else if (tc.toolName === 'copyFile') {
            status = 'Copying file';
            currentToolLabel = '';
          } else if (tc.toolName === 'renameFile') {
            status = 'Renaming file';
            currentToolLabel = '';
          } else if (tc.toolName === 'codeOutline') {
            const f = input?.filePath || 'code';
            status = `Analyzing ${f}`;
            currentToolLabel = `Analyzed ${f}`;
          } else if (tc.toolName === 'searchInFiles') {
            const q = input?.query ? String(input.query).slice(0, 60) : 'code';
            const d = input?.directory || '';
            const label = d ? `"${q}" in ${d}` : `"${q}"`;
            status = `Searching: ${label}`;
            currentToolLabel = `Searched: ${label}`;
          } else if (tc.toolName === 'semanticSearch') {
            const q = input?.query ? String(input.query).slice(0, 60) : 'code';
            status = `Searching: ${q}`;
            currentToolLabel = `Searched: ${q}`;
          } else if (tc.toolName === 'perplexity_search' && input?.query) {
            status = `Searching: ${input.query.slice(0, 60)}`;
            currentToolLabel = `Searched: ${input.query.slice(0, 60)}`;
          } else if (tc.toolName === 'parallel_search' && input?.objective) {
            status = `Searching: ${input.objective.slice(0, 60)}`;
            currentToolLabel = `Searched: ${input.objective.slice(0, 60)}`;
          } else if (tc.toolName === 'fetchUrl') {
            status = 'Fetching URL';
            currentToolLabel = 'Fetched URL';
          } else {
            status = toolActions[tc.toolName] ?? 'Working';
            currentToolLabel = '';
          }
          if (!wasEditStreamed) {
            callbacks.onStatus(status);
          }
          break;
        }

        case 'tool-result': {
          const tr = part as { toolName?: string; output?: ToolOutput };
          debug(`tool-result: ${tr.toolName}`);
          const out = tr.output;

          if (out?.tree && typeof out.tree === 'string') {
            const treeLines = out.tree.split('\n');
            const dirName = treeLines[0] || '.';
            const treeBody = treeLines.slice(1).join('\n');
            const label = currentToolLabel || `Listed ${dirName}`;
            callbacks.onMessage('tool', `> ${label}\n${treeBody}`);
            silent = true;
          } else if (out?.results && Array.isArray(out.results)) {
            searchResults = out.results as Array<{
              title?: string;
              url?: string;
              snippet?: string;
              excerpt?: string;
            }>;
          } else if (out?.content && typeof out.content === 'string') {
            fetchContent = out.content;
          } else if (out?.output && typeof out.output === 'string') {
            if (!out.output.startsWith('$ ') && currentToolLabel) {
              callbacks.onMessage(
                'tool',
                `> ${currentToolLabel}\n${out.output}`,
              );
            } else {
              callbacks.onMessage('tool', out.output);
            }
            silent = true;
          } else if (out?.answer && typeof out.answer === 'string') {
            const label = currentToolLabel || 'Result';
            callbacks.onMessage('tool', `> ${label}\n${out.answer}`);
            silent = true;
          } else if (out?.message && typeof out.message === 'string') {
            callbacks.onMessage('info', out.message);
            silent = out.silent === true;
          } else if (out?.error && typeof out.error === 'string') {
            callbacks.onMessage('error', out.error);
            silent = false;
          } else if (out?.silent === true) {
            silent = true;
          }

          // Don't flash "thinking..." between consecutive tool calls.
          // The next event (tool-call or text-delta) will set its own status.
          if (silent) {
            callbacks.onStatus('');
          }
          break;
        }

        case 'text-delta': {
          flushReasoning();
          const td = part as { text: string };
          callbacks.onStatus('');
          buffer += td.text;
          callbacks.onPending(buffer);
          break;
        }

        case 'step-finish': {
          flushReasoning();
          const sf = part as { finishReason?: string };
          debug(`step-finish: ${sf.finishReason}`);
          break;
        }

        case 'finish': {
          const fp = part as { finishReason?: string };
          lastFinishReason = fp.finishReason ?? '';
          break;
        }
      }

      if (streamError) break;
    }
  } catch (e) {
    streamError = e instanceof Error ? e : new Error(String(e));
  }

  flushReasoning();
  callbacks.onBusy(false);
  callbacks.onStatus('');

  if (streamError) {
    history.length = historyLen;
    throw streamError;
  }

  // When the stream ends because the step limit was reached mid-tool-use,
  // notify the user so they know the agent didn't just silently stop.
  if (lastFinishReason === 'tool-calls' && !buffer) {
    const reason = getStopReason();
    if (reason === 'stuck-loop') {
      callbacks.onMessage(
        'info',
        'Stopped: agent appeared stuck (repeated errors). Try rephrasing or checking tool output.',
      );
    } else {
      callbacks.onMessage(
        'info',
        `Reached step limit (${steps}). Send a follow-up to continue, or use /settings steps <n> to adjust.`,
      );
    }
  }

  if (buffer) {
    if (silent) {
      // Text was already displayed via onPending; record without re-rendering
      callbacks.onRecord('assistant', buffer);
    } else {
      callbacks.onMessage('assistant', buffer);
    }
    callbacks.onPending('');
  }

  if (silent) {
    chat.messages.push({ role: 'user', content: message });
    if (chat.messages.length === 2 && chat.title === 'New chat') {
      chat.title = message.slice(0, 50).trim();
    }
    Promise.resolve(result.response)
      .then((res) => {
        for (const m of res.messages) {
          if (m.role === 'assistant' || m.role === 'tool') {
            history.push(m);
          }
        }
      })
      .catch(() => {});
    Promise.resolve(result.usage)
      .then((u) => {
        if (u?.totalTokens) callbacks.onTokens((t) => t + (u.totalTokens ?? 0));
        if (u) callbacks.onUsage?.(extractTokenUsage(u as UsageResult));
      })
      .catch(() => {});
    Promise.resolve(
      result.providerMetadata as PromiseLike<ProviderMeta | undefined>,
    )
      .then((m) => {
        if (m?.gateway?.cost)
          callbacks.onCost(
            (c) => c + (Number.parseFloat(m.gateway?.cost ?? '0') || 0),
          );
      })
      .catch(() => {});
    return chat;
  }

  const response = await result.response.then(
    (r) => r,
    (e: unknown) => {
      history.length = historyLen;
      throw e;
    },
  );

  const needsContinuation = !buffer && (searchResults || fetchContent);

  if (needsContinuation) {
    callbacks.onStatus('thinking...');

    let contextMsg = '';
    if (searchResults && searchResults.length > 0) {
      contextMsg = `Search results:\n${searchResults
        .slice(0, 5)
        .map(
          (r) =>
            `- ${r.title ?? 'untitled'}: ${r.snippet ?? r.excerpt ?? ''} (${r.url ?? ''})`,
        )
        .join('\n')}`;
    } else if (fetchContent) {
      contextMsg = `Fetched content:\n${fetchContent.slice(0, 4000)}`;
    }

    const contHistory: ModelMessage[] = [
      ...history,
      {
        role: 'assistant' as const,
        content: `I found this information:\n\n${contextMsg}`,
      },
      {
        role: 'user' as const,
        content: 'Please summarize and explain what you found.',
      },
    ];

    const contResult = streamText({
      model,
      system: buildSystemParam(sys, model),
      messages: contHistory,
      stopWhen: stepCountIs(1),
      providerOptions: {
        openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' },
      },
      headers: AI_CLI_HEADERS,
      abortSignal: options.abortSignal,
      onError: () => {},
    });

    let contBuffer = '';
    try {
      for await (const part of contResult.fullStream) {
        if (part.type === 'text-delta') {
          callbacks.onStatus('');
          contBuffer += part.text;
          callbacks.onPending(contBuffer);
        } else if (part.type === 'reasoning-delta' && part.text) {
          callbacks.onStatus(part.text.replace(/\s+/g, ' ').trim().slice(-80));
        }
      }
    } catch (e) {
      debug(`continuation error: ${e}`);
    }

    callbacks.onStatus('');

    if (contBuffer) {
      buffer = contBuffer;
      callbacks.onMessage('assistant', contBuffer);
      callbacks.onPending('');
    }

    const contUsage = await contResult.usage;
    const contMeta = (await contResult.providerMetadata) as
      | ProviderMeta
      | undefined;

    if (contUsage?.totalTokens) {
      callbacks.onTokens((t) => t + (contUsage.totalTokens ?? 0));
    }
    if (contUsage) {
      callbacks.onUsage?.(extractTokenUsage(contUsage as UsageResult));
    }
    if (contMeta?.gateway?.cost) {
      callbacks.onCost(
        (c) => c + (Number.parseFloat(contMeta.gateway?.cost ?? '0') || 0),
      );
    }
  }

  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  const toolNames: Record<string, string> = {};

  type ResponsePart = {
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
  };
  for (const m of response.messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const p of m.content as ResponsePart[]) {
        if (p.type === 'tool-call' && p.toolCallId) {
          toolUseIds.add(p.toolCallId);
          toolNames[p.toolCallId] = p.toolName ?? p.toolCallId;
        }
        if (p.type === 'tool-result' && p.toolCallId) {
          toolResultIds.add(p.toolCallId);
        }
      }
    } else if (m.role === 'tool' && Array.isArray(m.content)) {
      for (const p of m.content as ResponsePart[]) {
        if (p.type === 'tool-result' && p.toolCallId) {
          toolResultIds.add(p.toolCallId);
        }
      }
    }
  }

  const unpairedIds = [...toolUseIds].filter((id) => !toolResultIds.has(id));
  if (unpairedIds.length > 0) {
    const names = unpairedIds.map((id) => toolNames[id] ?? id).join(', ');
    debug(`unpaired tools: ${names}`);
    history.length = historyLen;
    throw new Error(`tool failed: ${names}`);
  }

  for (const m of response.messages) {
    if (m.role === 'assistant' || m.role === 'tool') {
      history.push(m);
    }
  }

  chat.messages.push({ role: 'user', content: message });

  const usage = await result.usage;
  const meta = (await result.providerMetadata) as ProviderMeta | undefined;

  if (usage?.totalTokens) {
    callbacks.onTokens((t) => t + (usage.totalTokens ?? 0));
  }
  if (usage) {
    callbacks.onUsage?.(extractTokenUsage(usage as UsageResult));
  }

  if (meta?.gateway?.cost) {
    callbacks.onCost(
      (c) => c + (Number.parseFloat(meta.gateway?.cost ?? '0') || 0),
    );
  }

  if (!silent) {
    let txt = '';
    for (const m of response.messages) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const p of m.content as ResponsePart[]) {
          if (p.type === 'text' && p.text) {
            txt += p.text;
          }
        }
      }
    }

    if (txt && !buffer) {
      callbacks.onMessage('assistant', txt);
    }

    const finalText = buffer || txt;
    if (finalText) {
      chat.messages.push({ role: 'assistant', content: finalText });
    }
  }

  if (chat.messages.length === 2 && chat.title === 'New chat') {
    const first = chat.messages.find((m) => m.role === 'user');
    if (first) {
      chat.title = first.content.slice(0, 50).trim();
    }
  }

  return chat;
}
