import { type ModelMessage, stepCountIs, streamText } from 'ai';
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
  onTokens: (fn: (t: number) => number) => void;
  onCost: (fn: (c: number) => number) => void;
  onSummary: (summary: string) => void;
  onBusy: (busy: boolean) => void;
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
  dirPath?: string;
  filePath?: string;
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

export async function streamChat(options: StreamOptions): Promise<Chat> {
  const { model, message, history, tokens, summary, pm, callbacks } = options;
  const chat = options.chat ?? getOrCreateChat(model);

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

  const steps = getSetting('steps') || 10;
  const useTools = options.hasTools !== false;

  let silent = false;
  let buffer = '';
  let reasoning = '';
  let reasoningStart = 0;
  let currentToolLabel = '';
  let streamError: Error | null = null;
  let searchResults: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    excerpt?: string;
  }> | null = null;
  let fetchContent: string | null = null;

  const result = await (async () => {
    try {
      const mcpTools = useTools ? await loadMcpTools() : {};
      return streamText({
        model,
        system: sys,
        messages: history,
        tools: useTools ? getTools(mcpTools) : undefined,
        stopWhen: stepCountIs(steps),
        providerOptions: {
          openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' },
        },
        headers: AI_CLI_HEADERS,
        abortSignal: options.abortSignal,
      });
    } catch (e) {
      history.length = historyLen;
      throw e;
    }
  })();

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

        case 'tool-call': {
          flushReasoning();
          const tc = part as {
            toolName: string;
            input?: ToolInput;
          };
          debug(`tool-call: ${tc.toolName}`);
          const input = tc.input;
          let status: string;

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
            const f = input?.filePath || 'file';
            status = `Deleting ${f}`;
            currentToolLabel = '';
          } else if (tc.toolName === 'copyFile') {
            status = 'Copying file';
            currentToolLabel = '';
          } else if (tc.toolName === 'renameFile') {
            status = 'Renaming file';
            currentToolLabel = '';
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
          callbacks.onStatus(status);
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
            callbacks.onStatus('thinking...');
          } else if (out?.content && typeof out.content === 'string') {
            fetchContent = out.content;
            callbacks.onStatus('thinking...');
          } else if (out?.output && typeof out.output === 'string') {
            if (!out.output.startsWith('$ ') && currentToolLabel) {
              callbacks.onMessage('tool', `> ${currentToolLabel}\n${out.output}`);
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

          if (silent) {
            callbacks.onStatus('');
          } else {
            callbacks.onStatus('thinking...');
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
      system: sys,
      messages: contHistory,
      stopWhen: stepCountIs(1),
      providerOptions: {
        openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' },
      },
      headers: AI_CLI_HEADERS,
      abortSignal: options.abortSignal,
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
