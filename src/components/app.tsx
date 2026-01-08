import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { type ModelMessage } from 'ai';
import { saveChat, createChat, deleteAllChats, listChats } from '../config/chats.js';
import { setModel as saveModel } from '../config/index.js';
import { formatError } from '../utils/errors.js';
import { detectPackageManager } from '../utils/package-manager.js';
import { killAllProcesses } from '../utils/processes.js';
import { commands, restoreHistory, resolveCommand } from '../commands/slash/index.js';
import { Message, type Message as MessageT, type MessageType } from './message.js';
import { ModelSelect } from './select.js';
import { Confirm } from './confirm.js';
import { setConfirmHandler, resolveConfirm } from '../tools/confirm.js';
import { renderMarkdown } from '../utils/markdown.js';
import { getSetting } from '../config/settings.js';
import { streamChat } from '../hooks/chat.js';
import type { Chat } from '../config/chats.js';
import type { Context } from '../commands/slash/types.js';

interface Props {
  model: string;
  version: string;
}

let msgId = 0;

export function App({ model: initialModel, version }: Props) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [model, setModel] = useState(initialModel);
  const [chat, setChat] = useState<Chat | null>(null);
  const [history] = useState<ModelMessage[]>([]);
  const [messages, setMessages] = useState<MessageT[]>([
    { id: msgId++, type: 'info', content: `ai ${version} [${initialModel}]` },
    { id: msgId++, type: 'info', content: 'type /help for commands' },
  ]);
  const [pending, setPending] = useState('');
  const [status, setStatus] = useState('');
  const [tokens, setTokens] = useState(0);
  const [cost, setCost] = useState(0);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeCount, setPurgeCount] = useState(0);
  const [toolConfirm, setToolConfirm] = useState<string | null>(null);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [inputKey, setInputKey] = useState(0);
  const pm = detectPackageManager();
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  const inputRef = useRef(input);

  useEffect(() => {
    setConfirmHandler((action) => setToolConfirm(action));
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const addMessage = useCallback((type: MessageType, content: string) => {
    setMessages(prev => [...prev, { id: msgId++, type, content }]);
  }, []);

  const cleanup = useCallback(() => {
    killAllProcesses();
    process.stdout.write('\x1b[?25h');
    exit();
  }, [exit]);

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') cleanup();
    if (key.escape && busy && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setBusy(false);
      setStatus('');
      setPending('');
      addMessage('info', 'cancelled');
    }
    if (key.upArrow && !busy && inputHistory.length > 0) {
      const newIndex = historyIndex < inputHistory.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(newIndex);
      setInput(inputHistory[inputHistory.length - 1 - newIndex] || '');
    }
    if (key.downArrow && !busy && historyIndex >= 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setInput(newIndex >= 0 ? inputHistory[inputHistory.length - 1 - newIndex] || '' : '');
    }
    if (key.tab && !busy && inputRef.current.startsWith('/')) {
      const partial = inputRef.current.slice(1).toLowerCase();
      const matches = Object.keys(commands).filter(c => c.startsWith(partial));
      if (matches.length === 1) {
        setInput(`/${matches[0]} `);
        setInputKey(k => k + 1);
      }
    }
  }, { isActive: !selecting && !confirmPurge && !toolConfirm });

  const handleModelSelect = useCallback((selected: string | null) => {
    setSelecting(false);
    if (selected) {
      saveModel(selected);
      setModel(selected);
      addMessage('info', `switched to ${selected}`);
    }
  }, [addMessage]);

  const handlePurgeConfirm = useCallback((confirmed: boolean) => {
    setConfirmPurge(false);
    if (confirmed) {
      const deleted = deleteAllChats();
      const newChat = createChat(model);
      process.stdout.write('\x1b[2J\x1b[H');
      setMessages([{ id: msgId++, type: 'info', content: `ai ${version} [${model}]` }]);
      setChat(newChat);
      setTokens(0);
      setCost(0);
      history.length = 0;
      addMessage('info', `deleted ${deleted} chat(s)`);
    } else {
      addMessage('info', 'cancelled');
    }
  }, [addMessage, history, model, version]);

  const handleToolConfirm = useCallback((confirmed: boolean) => {
    setToolConfirm(null);
    resolveConfirm(confirmed);
  }, []);

  const clearScreen = useCallback((newModel?: string) => {
    process.stdout.write('\x1b[2J\x1b[H');
    setMessages([{ id: msgId++, type: 'info', content: `ai ${version} [${newModel || model}]` }]);
  }, [model, version]);

  const submit = useCallback(async (val: string) => {
    const msg = val.trim();
    if (!msg) return;
    setInput('');
    setInputHistory(prev => [...prev, msg]);
    setHistoryIndex(-1);

    if (msg.toLowerCase() === 'exit' || msg.toLowerCase() === 'quit') {
      cleanup();
      return;
    }

    if (busy) return;

    if (msg.startsWith('/')) {
      const parts = msg.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      addMessage('user', msg);

      if ((cmd === 'list' || cmd === 'l') && !args) {
        setSelecting(true);
        return;
      }

      if (cmd === 'purge') {
        const chatCount = listChats().length;
        if (chatCount === 0) {
          addMessage('info', 'no chats to delete');
          return;
        }
        setPurgeCount(chatCount);
        setConfirmPurge(true);
        return;
      }

      const resolved = resolveCommand(cmd);
      const handler = commands[resolved];
      if (!handler) {
        addMessage('info', 'unknown command. type /help');
        return;
      }

      const ctx: Context = {
        model, version, chat, history, tokens, cost,
        rl: null as never,
        createRl: () => null as never,
        printHeader: () => {},
      };

      const res = await handler(ctx, args);
      if (res) {
        if (res.clearScreen) clearScreen(res.model);
        if (res.output && !res.clearScreen) addMessage('info', res.output);
        if (res.model) setModel(res.model);
        if (res.chat !== undefined) setChat(res.chat);
        if (res.tokens !== undefined) setTokens(res.tokens);
        if (res.cost !== undefined) setCost(res.cost);
        if (res.clearHistory) history.length = 0;
        if (res.summary) setSummary(res.summary);
        if (res.chat && cmd === 'chat' && res.chat) {
          setSummary(res.chat.summary || '');
          restoreHistory({ chat: res.chat }, history);
          let newMessages: MessageT[];
          if (res.chat.display && res.chat.display.length > 0) {
            newMessages = res.chat.display.map(m => ({ id: msgId++, type: m.type as MessageType, content: m.content }));
          } else {
            newMessages = [];
            for (const m of res.chat.messages) {
              newMessages.push({ id: msgId++, type: m.role as MessageType, content: m.content });
            }
          }
          process.stdout.write('\x1b[2J\x1b[H');
          setMessages(newMessages);
        } else if (chat) {
          setTimeout(() => {
            chat.display = messagesRef.current.map(m => ({ type: m.type, content: m.content }));
            saveChat(chat);
          }, 0);
        }
      }
      return;
    }

    addMessage('user', msg);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const updatedChat = await streamChat({
        model,
        message: msg,
        history,
        chat,
        tokens,
        summary,
        pm,
        callbacks: {
          onStatus: setStatus,
          onPending: setPending,
          onMessage: addMessage,
          onTokens: setTokens,
          onCost: setCost,
          onSummary: setSummary,
          onBusy: setBusy,
        },
        abortSignal: controller.signal,
      });
      setChat(updatedChat);
      setTimeout(() => {
        updatedChat.display = messagesRef.current.map(m => ({ type: m.type, content: m.content }));
        updatedChat.tokens = tokens;
        updatedChat.cost = cost;
        saveChat(updatedChat);
      }, 0);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      addMessage('error', formatError(e));
      setPending('');
      setBusy(false);
      setStatus('');
    }
  }, [addMessage, busy, chat, cleanup, clearScreen, cost, history, model, pm, summary, tokens, version]);

  return (
    <Box flexDirection="column">
      <Static items={messages}>
        {(msg) => <Message key={msg.id} message={msg} />}
      </Static>

      {pending && (
        <Box>
          <Text>{getSetting('markdown') ? renderMarkdown(pending) : pending}</Text>
        </Box>
      )}

      {selecting ? (
        <Box marginTop={getSetting('spacing')}>
          <ModelSelect current={model} onSelect={handleModelSelect} />
        </Box>
      ) : confirmPurge ? (
        <Box>
          <Confirm message={`delete ${purgeCount} chat(s)?`} onConfirm={handlePurgeConfirm} />
        </Box>
      ) : toolConfirm ? (
        <Box>
          <Confirm message={toolConfirm} onConfirm={handleToolConfirm} />
        </Box>
      ) : busy && status ? (
        <Box>
          <Text dimColor>{status}</Text>
        </Box>
      ) : !busy ? (
        <Box marginTop={getSetting('spacing')}>
          <Text dimColor>› </Text>
          <TextInput key={inputKey} value={input} onChange={setInput} onSubmit={submit} />
        </Box>
      ) : null}
    </Box>
  );
}
