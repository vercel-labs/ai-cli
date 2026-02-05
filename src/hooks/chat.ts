import { type ModelMessage, streamText, stepCountIs } from 'ai';
import { getTools, loadMcpTools } from '../tools/index.js';
import { log as debug } from '../utils/debug.js';
import { logError } from '../utils/errorlog.js';
import { getContextWindow, shouldCompress, summarizeHistory } from '../utils/context.js';
import { getOrCreateChat, saveChat, type Chat } from '../config/chats.js';
import { buildSystemPrompt, toolActions } from '../utils/prompt.js';
import { getSetting } from '../config/settings.js';

interface StreamCallbacks {
  onStatus: (status: string) => void;
  onPending: (text: string) => void;
  onMessage: (type: 'info' | 'tool' | 'assistant' | 'error', content: string) => void;
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

interface ContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
}

interface GatewayMeta {
  cost?: string;
}

interface ProviderMeta {
  gateway?: GatewayMeta;
}

export async function streamChat(options: StreamOptions): Promise<Chat> {
  const { model, message, history, tokens, summary, pm, callbacks } = options;
  let chat = options.chat ?? getOrCreateChat(model);

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

  type ContentPart = { type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string };
  const userContent: ContentPart[] = [{ type: 'text', text: message }];
  if (options.image) {
    userContent.unshift({ type: 'image', image: options.image.data, mimeType: options.image.mimeType });
  }
  history.push({ role: 'user', content: options.image ? userContent : message });

  const steps = getSetting('steps') || 10;
  const useTools = options.hasTools !== false;

  let silent = false;
  let buffer = '';
  let reasoning = '';
  let streamError: Error | null = null;
  let searchResults: Array<{ title?: string; url?: string; snippet?: string; excerpt?: string }> | null = null;
  let fetchContent: string | null = null;

  let result;
  try {
    const mcpTools = useTools ? await loadMcpTools() : {};
    result = streamText({
      model,
      system: sys,
      messages: history,
      tools: useTools ? getTools(mcpTools) : undefined,
      stopWhen: stepCountIs(steps),
      providerOptions: { openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' } },
      headers: { 'HTTP-Referer': 'https://www.npmjs.com/package/ai-cli', 'X-Title': 'ai-cli' },
      abortSignal: options.abortSignal,
    });
  } catch (e) {
    history.length = historyLen;
    throw e;
  }

  try {
    for await (const part of result.fullStream) {
      if (silent) break;

      switch (part.type) {
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
          if (part.text) {
            reasoning += part.text;
            callbacks.onStatus(reasoning.replace(/\s+/g, ' ').trim().slice(-80));
          }
          break;
        }

        case 'tool-call': {
          debug(`tool-call: ${part.toolName}`);
          let status = toolActions[part.toolName] ?? 'working...';
          const input = part.input as ToolInput | undefined;
          if (part.toolName === 'perplexity_search' && input?.query) {
            status = `searching: ${input.query.slice(0, 60)}`;
          } else if (part.toolName === 'parallel_search' && input?.objective) {
            status = `searching: ${input.objective.slice(0, 60)}`;
          } else if (part.toolName === 'runCommand' && input?.command) {
            status = `$ ${input.command.slice(0, 70)}`;
          } else if (part.toolName === 'fetchUrl') {
            status = 'fetching...';
          }
          callbacks.onStatus(status);
          break;
        }

        case 'tool-result': {
          debug(`tool-result: ${part.toolName}`);
          const out = part.output as ToolOutput | undefined;

          if (out?.tree && typeof out.tree === 'string') {
            callbacks.onMessage('tool', out.tree);
            silent = true;
          } else if (out?.results && Array.isArray(out.results)) {
            searchResults = out.results as Array<{ title?: string; url?: string; snippet?: string; excerpt?: string }>;
            callbacks.onStatus('thinking...');
          } else if (out?.content && typeof out.content === 'string') {
            fetchContent = out.content;
            callbacks.onStatus('thinking...');
          } else if (out?.output && typeof out.output === 'string') {
            callbacks.onMessage('tool', out.output);
            silent = true;
          } else if (out?.answer && typeof out.answer === 'string') {
            callbacks.onMessage('tool', out.answer);
            silent = true;
          } else if (out?.message && typeof out.message === 'string') {
            callbacks.onMessage('info', out.message);
            silent = out.silent === true;
          } else if (out?.error && typeof out.error === 'string') {
            callbacks.onMessage('error', out.error);
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
          callbacks.onStatus('');
          buffer += part.text;
          callbacks.onPending(buffer);
          break;
        }

        case 'step-finish': {
          debug(`step-finish: ${part.finishReason}`);
          break;
        }
      }

      if (streamError) break;
    }
  } catch (e) {
    streamError = e instanceof Error ? e : new Error(String(e));
  }

  callbacks.onBusy(false);
  callbacks.onStatus('');

  if (streamError) {
    history.length = historyLen;
    throw streamError;
  }

  if (buffer) {
    callbacks.onMessage('assistant', buffer);
    callbacks.onPending('');
  }

  let response;
  try {
    response = await result.response;
  } catch (e) {
    history.length = historyLen;
    throw e;
  }

  const needsContinuation = !silent && !buffer && (searchResults || fetchContent);

  if (needsContinuation) {
    callbacks.onStatus('thinking...');

    let contextMsg = '';
    if (searchResults && searchResults.length > 0) {
      contextMsg = `Search results:\n${searchResults.slice(0, 5).map(r =>
        `- ${r.title ?? 'untitled'}: ${r.snippet ?? r.excerpt ?? ''} (${r.url ?? ''})`
      ).join('\n')}`;
    } else if (fetchContent) {
      contextMsg = `Fetched content:\n${fetchContent.slice(0, 4000)}`;
    }

    const contHistory: ModelMessage[] = [
      ...history,
      { role: 'assistant' as const, content: `I found this information:\n\n${contextMsg}` },
      { role: 'user' as const, content: 'Please summarize and explain what you found.' },
    ];

    const contResult = streamText({
      model,
      system: sys,
      messages: contHistory,
      stopWhen: stepCountIs(1),
      providerOptions: { openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' } },
      headers: { 'HTTP-Referer': 'https://www.npmjs.com/package/ai-cli', 'X-Title': 'ai-cli' },
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
    const contMeta = await contResult.providerMetadata as ProviderMeta | undefined;

    if (contUsage?.totalTokens) {
      callbacks.onTokens(t => t + (contUsage.totalTokens ?? 0));
    }
    if (contMeta?.gateway?.cost) {
      callbacks.onCost(c => c + (Number.parseFloat(contMeta.gateway!.cost!) || 0));
    }
  }

  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  const toolNames: Record<string, string> = {};

  for (const m of response.messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const p of m.content as ContentPart[]) {
        if (p.type === 'tool-call' && p.toolCallId) {
          toolUseIds.add(p.toolCallId);
          toolNames[p.toolCallId] = p.toolName ?? p.toolCallId;
        }
        if (p.type === 'tool-result' && p.toolCallId) {
          toolResultIds.add(p.toolCallId);
        }
      }
    } else if (m.role === 'tool' && Array.isArray(m.content)) {
      for (const p of m.content as ContentPart[]) {
        if (p.type === 'tool-result' && p.toolCallId) {
          toolResultIds.add(p.toolCallId);
        }
      }
    }
  }

  const unpairedIds = [...toolUseIds].filter(id => !toolResultIds.has(id));
  if (unpairedIds.length > 0) {
    const names = unpairedIds.map(id => toolNames[id] ?? id).join(', ');
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
  const meta = await result.providerMetadata as ProviderMeta | undefined;

  if (usage?.totalTokens) {
    callbacks.onTokens(t => t + (usage.totalTokens ?? 0));
  }

  if (meta?.gateway?.cost) {
    callbacks.onCost(c => c + (Number.parseFloat(meta.gateway!.cost!) || 0));
  }

  if (!silent) {
    let txt = '';
    for (const m of response.messages) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const p of m.content as ContentPart[]) {
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
    const first = chat.messages.find(m => m.role === 'user');
    if (first) {
      chat.title = first.content.slice(0, 50).trim();
    }
  }

  return chat;
}
