import { type ModelMessage, stepCountIs, streamText } from 'ai';
import { fileTools } from '../tools/index.js';
import { log as debug } from '../utils/debug.js';
import { getContextWindow, shouldCompress, summarizeHistory } from '../utils/context.js';
import { getOrCreateChat, saveChat, type Chat } from '../config/chats.js';
import { buildSystemPrompt, toolActions } from '../utils/prompt.js';

interface StreamCallbacks {
  onStatus: (status: string) => void;
  onPending: (text: string) => void;
  onMessage: (type: 'info' | 'tool' | 'assistant' | 'error', content: string) => void;
  onTokens: (fn: (t: number) => number) => void;
  onCost: (fn: (c: number) => number) => void;
  onSummary: (summary: string) => void;
  onBusy: (busy: boolean) => void;
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
}

export async function streamChat(options: StreamOptions): Promise<Chat> {
  const { model, message, history, tokens, summary, pm, callbacks } = options;
  let chat = options.chat;

  if (!chat) {
    chat = getOrCreateChat(model);
  }

  debug(`input: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`);
  history.push({ role: 'user', content: message });
  chat.messages.push({ role: 'user', content: message });

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

  const sys = buildSystemPrompt(pm, summary);

  const result = streamText({
    model,
    system: sys,
    messages: history,
    tools: fileTools,
    stopWhen: stepCountIs(5),
    providerOptions: { openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' } },
    headers: { 'HTTP-Referer': 'https://www.npmjs.com/package/ai-cli', 'X-Title': 'ai-cli' },
    abortSignal: options.abortSignal,
  });

  let silent = false;
  let buffer = '';
  let reasoning = '';

  for await (const part of result.fullStream) {
    if (silent) continue;
    if (part.type === 'reasoning-delta' && part.text) {
      reasoning += part.text;
      callbacks.onStatus(reasoning.replace(/\s+/g, ' ').trim().slice(-80));
    } else if (part.type === 'tool-call') {
      callbacks.onStatus(toolActions[part.toolName] || 'working...');
    } else if (part.type === 'tool-result') {
      const out = part.output as Record<string, unknown> | undefined;
      if (out?.tree && typeof out.tree === 'string') {
        callbacks.onMessage('tool', out.tree);
        silent = true;
        callbacks.onBusy(false);
        callbacks.onStatus('');
      } else if (out?.results && typeof out.results === 'string') {
        callbacks.onMessage('tool', out.results);
        silent = true;
        callbacks.onBusy(false);
        callbacks.onStatus('');
      } else if (out?.output && typeof out.output === 'string') {
        callbacks.onMessage('tool', out.output);
        silent = true;
        callbacks.onBusy(false);
        callbacks.onStatus('');
      } else if (out?.message && typeof out.message === 'string') {
        callbacks.onMessage('info', out.message);
        if (out?.silent === true) {
          silent = true;
          callbacks.onBusy(false);
          callbacks.onStatus('');
        } else {
          callbacks.onStatus('thinking...');
        }
      } else if (out?.silent === true) {
        silent = true;
        callbacks.onBusy(false);
        callbacks.onStatus('');
      } else {
        callbacks.onStatus('thinking...');
      }
    } else if (part.type === 'text-delta') {
      callbacks.onStatus('');
      buffer += part.text;
      callbacks.onPending(buffer);
    }
  }

  if (buffer) {
    callbacks.onMessage('assistant', buffer);
    callbacks.onPending('');
    callbacks.onBusy(false);
    callbacks.onStatus('');
  }

  if (silent) {
    callbacks.onBusy(false);
    callbacks.onStatus('');
    const r = await result.response;
    for (const m of r.messages) {
      if (m.role === 'assistant' || m.role === 'tool') history.push(m);
    }
  } else {
    const r = await result.response;
    const u = await result.usage;
    const meta = await result.providerMetadata;
    if (u?.totalTokens) callbacks.onTokens(t => t + (u.totalTokens ?? 0));
    const gw = (meta as Record<string, unknown>)?.gateway as Record<string, unknown> | undefined;
    if (gw?.cost && typeof gw.cost === 'string') {
      callbacks.onCost(c => c + (Number.parseFloat(gw.cost as string) || 0));
    }
    let txt = '';
    for (const m of r.messages) {
      if (m.role === 'assistant' || m.role === 'tool') {
        history.push(m);
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          for (const p of m.content) if (p.type === 'text') txt += p.text;
        }
      }
    }
    if (txt) chat.messages.push({ role: 'assistant', content: txt });
  }

  if (chat.messages.length === 2 && chat.title === 'New chat') {
    const first = chat.messages.find(m => m.role === 'user');
    if (first) chat.title = first.content.slice(0, 50).trim();
  }

  return chat;
}
