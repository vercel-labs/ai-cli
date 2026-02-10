import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';
import type { ModelMessage } from 'ai';
import ansi from 'ansi-escapes';
import {
  commands,
  getCompletions,
  resolveCommand,
  restoreHistory,
} from '../commands/slash/index.js';
import { setConfirmHandler } from '../tools/confirm.js';
import { killRunningCommand } from '../tools/run-command.js';
import type { Context } from '../commands/slash/types.js';
import { addRule } from '../utils/permissions.js';
import type { Chat } from '../config/chats.js';
import {
  createChat,
  deleteAllChats,
  listChats,
  saveChat,
} from '../config/chats.js';
import { setModel as saveModel } from '../config/index.js';
import { getSetting } from '../config/settings.js';
import { streamChat } from '../hooks/chat.js';
import { getClipboardImage } from '../utils/clipboard.js';
import { formatError } from '../utils/errors.js';
import { renderMarkdown } from '../utils/markdown.js';
import { mask } from '../utils/mask.js';
import {
  fetchModels,
  getModelCapabilities,
  type ModelCapabilities,
  scoreMatch,
} from '../utils/models.js';
import { detectPackageManager } from '../utils/package-manager.js';
import { killAllProcesses } from '../utils/processes.js';
import { createStreamWrap, wrap } from '../utils/wrap.js';
import { Output } from './output.js';

interface ReadlineInternal extends readline.Interface {
  line: string;
  cursor: number;
  history: string[];
}

type MessageType = 'user' | 'assistant' | 'tool' | 'error' | 'info';

interface Message {
  type: MessageType;
  content: string;
}

import { dim, dimmer, green, red } from '../utils/color.js';

const setTitle = (s: string) => process.stdout.write(`\x1b]0;${s}\x07`);

export async function terminal(model: string, version: string): Promise<void> {
  const out = new Output();

  let currentModel = model;
  let chat: Chat | null = null;
  const history: ModelMessage[] = [];
  const messages: Message[] = [];
  let tokens = 0;
  let cost = 0;
  let summary = '';
  let busy = false;
  let abortController: AbortController | null = null;
  const pm = detectPackageManager();
  let statusText = '';
  let streamBuffer = '';
  let currentStreamWrap: ReturnType<typeof createStreamWrap> | null = null;
  let selectMode = false;
  let confirmMode = false;
  let commandMode = false;
  let cmdSuggestionCount = 0; // number of suggestion lines currently rendered
  let editStreamRendered = false;
  let editStreamLineCount = 0;
  let pendingImage: { data: string; mimeType: string } | null = null;
  let capabilities: ModelCapabilities = {
    vision: true,
    tools: true,
    reasoning: false,
  };

  function clearCmdSuggestions(): void {
    if (cmdSuggestionCount > 0) {
      process.stdout.write(ansi.cursorSavePosition);
      for (let i = 0; i < cmdSuggestionCount; i++) {
        process.stdout.write(`\n${ansi.eraseLine}`);
      }
      process.stdout.write(ansi.cursorRestorePosition);
      cmdSuggestionCount = 0;
    }
  }

  function renderCmdSuggestions(input: string): void {
    clearCmdSuggestions();
    const [completions] = getCompletions(`/${input}`);
    if (completions.length === 0) return;

    process.stdout.write(ansi.cursorSavePosition);
    const toShow = completions.slice(0, 8);
    for (const c of toShow) {
      process.stdout.write(`\n${ansi.eraseLine}${dim(`  ${c.slice(1)}`)}`);
    }
    if (completions.length > 8) {
      process.stdout.write(
        `\n${ansi.eraseLine}${dim(`  ... ${completions.length - 8} more`)}`,
      );
      cmdSuggestionCount = toShow.length + 1;
    } else {
      cmdSuggestionCount = toShow.length;
    }
    process.stdout.write(ansi.cursorRestorePosition);
  }

  async function updateCapabilities(modelId: string): Promise<void> {
    try {
      capabilities = await getModelCapabilities(modelId);
    } catch {
      capabilities = { vision: true, tools: true, reasoning: false };
    }
  }

  updateCapabilities(currentModel);

  function updateTitle() {
    const branchResult = spawnSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
    });
    const branch = branchResult.status === 0 ? branchResult.stdout?.trim() : '';

    if (branch) {
      const diffResult = spawnSync('git', ['diff', '--shortstat'], {
        encoding: 'utf-8',
      });
      const stat = diffResult.stdout?.trim() || '';
      const adds = stat.match(/(\d+) insertion/)?.[1] || '0';
      const dels = stat.match(/(\d+) deletion/)?.[1] || '0';
      const changes = stat ? ` +${adds} -${dels}` : '';
      setTitle(`${branch}${changes}`);
    } else {
      const modelShort = currentModel.split('/').pop() || currentModel;
      const costStr = cost > 0 ? ` $${cost.toFixed(2)}` : '';
      setTitle(`${modelShort}${costStr}`);
    }
  }

  const inputStream = new PassThrough();

  const rl = readline.createInterface({
    input: inputStream,
    output: process.stdout,
    prompt: dim('› '),
    terminal: true,
    escapeCodeTimeout: 50,
    completer: (line: string) => getCompletions(line),
  });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  setConfirmHandler(
    (action, opts) =>
      new Promise<boolean>((resolve) => {
        // Flush stream & clear status BEFORE locking so they render normally
        clearStatus();
        if (streamBuffer && currentStreamWrap) {
          const remaining = currentStreamWrap.flush();
          if (remaining) out.write(remaining);
          streamBuffer = '';
          currentStreamWrap.reset();
          out.write('\n');
        }

        // Lock output — all other out.write() calls are now silently dropped
        const lock = out.lock();
        if (!lock) {
          // Another modal already owns the output; auto-deny to avoid corruption
          resolve(false);
          return;
        }
        confirmMode = true;

        const options = ['yes', 'no', 'always'];
        let selected = 0;

        // Split multiline actions: write header/body once, re-render only options
        const actionLines = action.split('\n');
        const headerLine = actionLines[0];
        const bodyLines = actionLines.slice(1);
        const hasBody = bodyLines.length > 0;

        let wasEditStream = false;
        if (editStreamRendered) {
          // Diff was already streamed to screen — just add spacing
          wasEditStream = true;
          editStreamRendered = false;
          editStreamLineCount = 0;
          lock.write('\n');
        } else {
          // Dim the verb and punctuation but keep the subject readable.
          // Confirm actions follow "Verb subject?" pattern.
          const qIdx = headerLine.lastIndexOf('?');
          const spIdx = headerLine.indexOf(' ');
          if (spIdx > 0 && qIdx > spIdx) {
            const verb = headerLine.slice(0, spIdx + 1);
            const subject = headerLine.slice(spIdx + 1, qIdx);
            const punct = headerLine.slice(qIdx);
            lock.write(`${dim(verb)}${subject}${dim(punct)}\n`);
          } else {
            lock.write(`${dim(headerLine)}\n`);
          }
          if (hasBody) {
            for (const line of bodyLines) {
              lock.write(`  ${line}\n`);
            }
            lock.write('\n');
          }
        }

        const render = () => {
          const parts = options.map((opt, i) =>
            i === selected ? `${dim('[')}${opt}${dim(']')}` : dim(` ${opt} `),
          );
          lock.write(`\r${ansi.eraseLine}${dim('› ')}${parts.join(dim('  '))}`);
        };

        render();

        const finish = (choice: string) => {
          process.stdin.removeListener('keypress', onKey);
          const accepted = choice === 'yes' || choice === 'always';

          if (accepted && !hasBody && !wasEditStream) {
            // Erase the confirm prompt entirely for simple confirms (e.g.
            // "Run: git clone ...?") — the tool result will describe what
            // happened (e.g. "Ran git clone ..."), so keeping both is noisy.
            const linesToErase = 1; // header line
            lock.write(`\r${ansi.eraseLine}`); // clear options line
            for (let i = 0; i < linesToErase; i++) {
              lock.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
            }
            // Leave a blank line so the tool result has spacing from the prompt
            lock.write('\n');
          } else {
            lock.write(`\r${ansi.eraseLine}${dim(`› ${choice}`)}\n`);
          }

          // Release lock BEFORE resolving so downstream writes render again
          confirmMode = false;
          lock.release();
          if (choice === 'always') {
            // Persist the rule for this tool/command in this directory
            if (opts?.tool) {
              addRule(opts.tool, process.cwd(), opts.command);
            }
            resolve(true);
          } else {
            resolve(choice === 'yes');
          }
        };

        const onKey = (
          str: string | undefined,
          key: { name?: string; ctrl?: boolean } | undefined,
        ) => {
          const name = key?.name;

          if (name === 'left' || name === 'up') {
            selected = Math.max(0, selected - 1);
            render();
            return;
          }
          if (name === 'right' || name === 'down') {
            selected = Math.min(options.length - 1, selected + 1);
            render();
            return;
          }
          if (name === 'return') return finish(options[selected]);
          if (name === 'escape') return finish('no');
          if (key?.ctrl && name === 'c') return finish('no');

          const ch = (str ?? '').toLowerCase();
          if (ch === 'y') return finish('yes');
          if (ch === 'n') return finish('no');
          if (ch === 'a') return finish('always');
        };

        process.stdin.on('keypress', onKey);
      }),
  );

  process.stdin.on('data', (chunk: Buffer) => {
    const str = chunk.toString();

    if (confirmMode) return;

    if (busy && (str === '\x1b' || str === '\x03') && abortController) {
      killRunningCommand();
      abortController.abort();
      return;
    }

    if (selectMode || busy) {
      inputStream.write(chunk);
      return;
    }

    if (str === '\x16') {
      if (!capabilities.vision) {
        process.stdout.write(
          '\r' +
            ansi.eraseLine +
            dim('› ') +
            dim('[model does not support images]'),
        );
        setTimeout(() => {
          process.stdout.write(
            `\r${ansi.eraseLine}${dim('› ')}${(rl as ReadlineInternal).line}`,
          );
        }, 1500);
        return;
      }
      const imgBuffer = getClipboardImage();
      if (imgBuffer) {
        pendingImage = {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
        };
        const internal = rl as ReadlineInternal;
        const line = internal.line;
        const cursor = internal.cursor;
        const marker = '[image]';
        const newLine = line.slice(0, cursor) + marker + line.slice(cursor);
        internal.line = newLine;
        internal.cursor = cursor + marker.length;
        const prefix = commandMode ? '/ ' : '› ';
        process.stdout.write(`\r${ansi.eraseLine}${dim(prefix)}${newLine}`);
      }
      return;
    }

    if (!commandMode && rl.line === '' && str === '/') {
      commandMode = true;
      rl.setPrompt(dim('/ '));
      process.stdout.write(`\r${ansi.eraseLine}${dim('/ ')}`);
      renderCmdSuggestions('');
      return;
    }

    if (commandMode && rl.line === '' && (str === '\x7f' || str === '\b')) {
      commandMode = false;
      clearCmdSuggestions();
      rl.setPrompt(dim('› '));
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
      return;
    }

    if (str === '\t' && commandMode) {
      const internal = rl as ReadlineInternal;
      const [completions] = getCompletions(`/${internal.line}`);
      if (completions.length === 1) {
        const completed = `${completions[0].slice(1)} `;
        internal.line = completed;
        internal.cursor = completed.length;
        clearCmdSuggestions();
        process.stdout.write(`\r${ansi.eraseLine}${dim('/ ')}${completed}`);
      } else if (completions.length > 1) {
        const common = completions
          .reduce((a, b) => {
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            return a.slice(0, i);
          })
          .slice(1);
        if (common.length > internal.line.length) {
          internal.line = common;
          internal.cursor = common.length;
          process.stdout.write(`\r${ansi.eraseLine}${dim('/ ')}${common}`);
          renderCmdSuggestions(common);
        }
      }
      return;
    }

    if (str === '\x1b' && str.length === 1) {
      commandMode = false;
      clearCmdSuggestions();
      pendingImage = null;
      rl.setPrompt(dim('› '));
      (rl as ReadlineInternal).line = '';
      (rl as ReadlineInternal).cursor = 0;
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
      return;
    }

    if (str === '\x1b[1;3D' || str === '\x1bb') {
      inputStream.write('\x1bb');
      return;
    }

    if (str === '\x1b[1;3C' || str === '\x1bf') {
      inputStream.write('\x1bf');
      return;
    }

    inputStream.write(chunk);

    // Update command suggestions after readline processes the keystroke
    if (commandMode) {
      setImmediate(() => {
        const line = (rl as ReadlineInternal).line;
        renderCmdSuggestions(line);
      });
    }
  });

  function cleanup() {
    killAllProcesses();
    process.stdout.write(`\n${ansi.cursorShow}`);
    rl.close();
    process.exit(0);
  }

  function redraw() {
    if (busy || selectMode || confirmMode) return;
    process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
    for (const msg of messages) {
      printMessage(msg);
    }
    const spacing = getSetting('spacing') ?? 1;
    process.stdout.write('\n'.repeat(spacing));
    rl.prompt();
  }

  process.stdout.on('resize', redraw);

  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  let spinnerIdx = 0;

  function clearStatus() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    if (statusText) {
      out.write(ansi.cursorUp(1) + ansi.eraseLine + ansi.cursorLeft);
      statusText = '';
    }
  }

  function showStatus(text: string) {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    if (statusText) {
      out.write(ansi.cursorUp(1) + ansi.eraseLine + ansi.cursorLeft);
    }
    spinnerIdx = 0;
    out.write(`${dim(`${spinnerFrames[0]} ${text}`)}\n`);
    statusText = text;

    spinnerTimer = setInterval(() => {
      if (!statusText) return;
      spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
      out.write(ansi.cursorUp(1) + ansi.eraseLine + ansi.cursorLeft);
      out.write(`${dim(`${spinnerFrames[spinnerIdx]} ${statusText}`)}\n`);
    }, 80);
  }

  function formatToolOutput(text: string): string {
    const TAIL = 5;
    const lines = text.split('\n');

    // Command output: first line is "$ command"
    if (lines[0]?.startsWith('$ ')) {
      const command = lines[0].slice(2);
      const body = lines.slice(1);
      const header = `Ran ${command}`;

      if (body.length === 0) return header;

      if (body.length > TAIL) {
        const hidden = body.length - TAIL;
        const tail = body.slice(-TAIL).map((l) => `  ${l}`);
        return `${header}\n  ... ${hidden} lines ...\n${tail.join('\n')}`;
      }
      return `${header}\n${body.map((l) => `  ${l}`).join('\n')}`;
    }

    // Labeled tool output: "> Label\nbody"
    if (lines[0]?.startsWith('> ')) {
      const header = lines[0].slice(2);
      const body = lines.slice(1);

      if (body.length === 0) return header;

      if (body.length > TAIL) {
        const hidden = body.length - TAIL;
        const tail = body.slice(-TAIL).map((l) => `  ${l}`);
        return `${header}\n  ... ${hidden} lines ...\n${tail.join('\n')}`;
      }
      return `${header}\n${body.map((l) => `  ${l}`).join('\n')}`;
    }

    // Other tool output: indent all lines
    if (lines.length > TAIL) {
      const hidden = lines.length - TAIL;
      const tail = lines.slice(-TAIL).map((l) => `  ${l}`);
      return `  ... ${hidden} lines ...\n${tail.join('\n')}`;
    }
    return lines.map((l) => `  ${l}`).join('\n');
  }

  function printMessage(msg: Message) {
    const markdown = getSetting('markdown');
    switch (msg.type) {
      case 'user':
        out.write(`${dim('› ') + wrap(msg.content)}\n\n`);
        break;
      case 'assistant': {
        const content = markdown ? renderMarkdown(msg.content) : msg.content;
        out.write(`${wrap(mask(content))}\n`);
        break;
      }
      case 'tool': {
        const formatted = formatToolOutput(mask(msg.content));
        const nlIdx = formatted.indexOf('\n');
        if (nlIdx >= 0) {
          const header = formatted.slice(0, nlIdx);
          const body = formatted.slice(nlIdx + 1);
          out.write(`${dim(header)}\n${dimmer(body)}\n\n`);
        } else {
          out.write(`${dim(formatted)}\n\n`);
        }
        break;
      }
      case 'info': {
        // Highlight the subject in "Verb subject" messages (e.g. "Deleted blog/")
        const spaceIdx = msg.content.indexOf(' ');
        if (spaceIdx > 0 && !msg.content.includes('\n')) {
          const verb = msg.content.slice(0, spaceIdx + 1);
          const subject = msg.content.slice(spaceIdx + 1);
          out.write(`${dim(verb)}${subject}\n\n`);
        } else {
          out.write(`${dim(wrap(msg.content))}\n\n`);
        }
        break;
      }
      case 'error':
        out.write(`${dim(`error: ${wrap(msg.content)}`)}\n`);
        break;
    }
  }

  function addMessage(type: MessageType, content: string) {
    messages.push({ type, content });
  }

  function addAndPrint(type: MessageType, content: string) {
    addMessage(type, content);
    printMessage({ type, content });
  }

  async function selectModel(): Promise<string | null> {
    process.stdout.write(dim('loading models...\n'));

    let models: string[];
    try {
      const m = await fetchModels();
      models = m.map((x) => x.id);
    } catch {
      process.stdout.write(dim('failed to load models\n'));
      return null;
    }

    return new Promise((resolve) => {
      let filtered = models;
      let search = '';
      let index = models.indexOf(currentModel);
      if (index === -1) index = 0;
      let closed = false;

      const render = () => {
        process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
        process.stdout.write(search || dim('type to filter...'));
        process.stdout.write(
          `\n${dim('↑↓ navigate · enter select · esc cancel')}\n\n`,
        );
        const start = Math.max(0, index - 5);
        const visible = filtered.slice(start, start + 10);
        visible.forEach((id, i) => {
          const selected = start + i === index;
          process.stdout.write(
            `${(selected ? '› ' : '  ') + (selected ? id : dim(id))}\n`,
          );
        });
        process.stdout.write(`\n${dim(`current: ${currentModel}`)}\n`);
        process.stdout.write(ansi.cursorTo(search.length, 0));
      };

      const filter = () => {
        if (search) {
          filtered = models
            .map((id) => ({ id, score: scoreMatch(id, search) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((x) => x.id);
        } else {
          filtered = models;
        }
        index = 0;
        render();
      };

      const finish = (result: string | null) => {
        if (closed) return;
        closed = true;

        try {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
        } catch {}
        process.stdin.removeListener('keypress', onKeypress);

        process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
        for (const msg of messages) printMessage(msg);

        setImmediate(() => resolve(result));
      };

      const onKeypress = (str: string | undefined, key: readline.Key) => {
        if (closed || !key) return;

        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
          finish(null);
        } else if (key.name === 'return') {
          finish(filtered[index] || null);
        } else if (key.name === 'up') {
          index = Math.max(0, index - 1);
          render();
        } else if (key.name === 'down') {
          index = Math.min(filtered.length - 1, index + 1);
          render();
        } else if (key.name === 'backspace') {
          search = search.slice(0, -1);
          filter();
        } else if (str && str.length === 1 && str >= ' ') {
          search += str;
          filter();
        }
      };

      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
      } catch {}
      process.stdin.on('keypress', onKeypress);
      render();
    });
  }

  async function handleInput(line: string) {
    if (selectMode) return;

    let msg = line.trim();

    if (commandMode) {
      clearCmdSuggestions();
      commandMode = false;
      rl.setPrompt(dim('› '));
      if (msg) {
        msg = `/${msg}`;
        (rl as ReadlineInternal).history.unshift(msg);
      }
    }

    if (!msg) {
      prompt();
      return;
    }

    if (msg.toLowerCase() === 'exit' || msg.toLowerCase() === 'quit') {
      cleanup();
      return;
    }

    if (busy) return;

    if (msg.startsWith('/')) {
      const parts = msg.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      if ((cmd === 'model' || cmd === 'm') && !args) {
        selectMode = true;
        const selected = await selectModel();
        selectMode = false;
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        if (selected) {
          saveModel(selected);
          currentModel = selected;
          await updateCapabilities(selected);
          updateTitle();
          addAndPrint('info', `switched to ${selected}`);
        }
        prompt();
        return;
      }

      if (cmd === 'purge') {
        const count = listChats().length;
        if (count === 0) {
          addAndPrint('info', 'no chats to delete');
          prompt();
          return;
        }
        const deleted = deleteAllChats();
        chat = createChat(currentModel);
        messages.length = 0;
        history.length = 0;
        tokens = 0;
        cost = 0;
        process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
        addAndPrint('info', `ai ${version} [${currentModel}]`);
        addAndPrint('info', `deleted ${deleted} chat(s)`);
        prompt();
        return;
      }

      const resolved = resolveCommand(cmd);
      const handler = commands[resolved];
      if (!handler) {
        addAndPrint('info', 'unknown command. type /help');
        prompt();
        return;
      }

      const ctx: Context = {
        model: currentModel,
        version,
        chat,
        history,
        tokens,
        cost,
        rl: rl,
        createRl: () => rl,
        printHeader: () => {},
      };

      const showCommitStatus = resolved === 'git' && args?.startsWith('commit');
      rl.pause();
      if (showCommitStatus) {
        process.stdout.write(dim('checking changes...'));
      }
      const res = await handler(ctx, args);
      if (showCommitStatus) {
        process.stdout.write(`\r${ansi.eraseLine}`);
      }
      rl.resume();
      if (res) {
        if (res.clearScreen) {
          process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
          messages.length = 0;
          addAndPrint('info', `ai ${version} [${res.model || currentModel}]`);
        }
        if (res.output) {
          addAndPrint('info', res.output);
        }
        if (res.model) {
          currentModel = res.model;
          await updateCapabilities(res.model);
        }
        if (res.chat !== undefined) chat = res.chat;
        if (res.tokens !== undefined) tokens = res.tokens;
        if (res.cost !== undefined) cost = res.cost;
        if (res.model || res.cost !== undefined) updateTitle();
        if (res.clearHistory) history.length = 0;
        if (res.summary) summary = res.summary;
        if (res.chat && cmd === 'chat' && res.chat) {
          summary = res.chat.summary || '';
          restoreHistory({ chat: res.chat }, history);
          process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
          messages.length = 0;
          const display = res.chat.display?.length
            ? res.chat.display
            : res.chat.messages.map((m) => ({
                type: m.role,
                content: m.content,
              }));
          const spacing = getSetting('spacing') ?? 1;
          let lastType = '';
          for (let i = 0; i < display.length; i++) {
            const m = display[i];
            const isLast = i === display.length - 1;
            if (lastType === 'info' && m.type !== 'info') {
              process.stdout.write('\n'.repeat(spacing));
            }
            addAndPrint(m.type as MessageType, m.content);
            if (!isLast && m.type !== 'user' && m.type !== 'info') {
              process.stdout.write('\n'.repeat(spacing));
            }
            lastType = m.type;
          }
        } else if (chat) {
          chat.display = messages.map((m) => ({
            type: m.type,
            content: m.content,
          }));
          saveChat(chat);
        }
      }
      prompt();
      return;
    }

    addMessage('user', msg);

    busy = true;
    const controller = new AbortController();
    abortController = controller;
    streamBuffer = '';
    const streamWrap = createStreamWrap();
    currentStreamWrap = streamWrap;

    process.stdout.write(ansi.cursorHide);
    rl.pause();
    out.write('\n');

    try {
      const updatedChat = await streamChat({
        model: currentModel,
        message: msg,
        history,
        chat,
        tokens,
        summary,
        pm,
        callbacks: {
          onStatus: (s) => {
            if (s) {
              if (!statusText && streamBuffer) {
                const remaining = streamWrap.flush();
                out.write(`${remaining}\n\n`);
                streamBuffer = '';
              }
              showStatus(s);
            } else {
              clearStatus();
            }
          },
          onPending: (text) => {
            clearStatus();
            if (text.length > streamBuffer.length) {
              const newText = text.slice(streamBuffer.length);
              const wrapped = streamWrap.write(mask(newText));
              out.write(wrapped);
              streamBuffer = text;
            }
          },
          onMessage: (type, content) => {
            clearStatus();
            if (type === 'assistant') {
              if (streamBuffer) {
                const remaining = streamWrap.flush();
                out.write(`${remaining}\n`);
              } else {
                printMessage({ type, content });
              }
              streamBuffer = '';
              streamWrap.reset();
            } else {
              printMessage({ type, content });
            }
            addMessage(type, content);
          },
          onRecord: (type, content) => {
            // Finalize stream wrap without re-rendering text
            if (type === 'assistant' && streamBuffer) {
              const remaining = streamWrap.flush();
              if (remaining) out.write(remaining);
              out.write('\n');
              streamBuffer = '';
              streamWrap.reset();
            }
            addMessage(type, content);
          },
          onReasoning: (text, durationMs) => {
            clearStatus();
            const seconds = Math.round(durationMs / 1000);
            const label =
              seconds > 0 ? `thought for ${seconds}s` : 'thought briefly';
            const truncated = text.replace(/\s+/g, ' ').trim().slice(0, 80);
            out.write(`${dim(label)}\n`);
            if (truncated) out.write(`${dim(`  ${truncated}`)}\n`);
            out.write('\n');
            addMessage(
              'info',
              `${label}${truncated ? `\n  ${truncated}` : ''}`,
            );
          },
          onEditStream: (filePath, oldLines, newLines, more) => {
            clearStatus();

            // Clear previously rendered streaming lines
            for (let i = 0; i < editStreamLineCount; i++) {
              out.write(ansi.cursorUp(1) + ansi.eraseLine + ansi.cursorLeft);
            }

            const basename = filePath.includes('/')
              ? (filePath.split('/').pop() ?? filePath)
              : filePath;
            const lines: string[] = [];
            lines.push(dim(`Edit ${basename}?`));
            for (const line of oldLines) {
              lines.push(`  ${red(`- ${line}`)}`);
            }
            for (const line of newLines) {
              lines.push(`  ${green(`+ ${line}`)}`);
            }
            if (more > 0) {
              lines.push(dim(`    ... ${more} more lines`));
            }

            for (const line of lines) {
              out.write(`${line}\n`);
            }

            editStreamLineCount = lines.length;
            editStreamRendered = true;
          },
          onTokens: (fn) => {
            tokens = fn(tokens);
          },
          onCost: (fn) => {
            cost = fn(cost);
            updateTitle();
          },
          onSummary: (s) => {
            summary = s;
          },
          onBusy: (b) => {
            busy = b;
          },
        },
        abortSignal: controller.signal,
        image: pendingImage,
        hasTools: capabilities.tools,
      });

      pendingImage = null;
      chat = updatedChat;
      updatedChat.display = messages.map((m) => ({
        type: m.type,
        content: m.content,
      }));
      updatedChat.tokens = tokens;
      updatedChat.cost = cost;
      saveChat(updatedChat);
    } catch (e) {
      clearStatus();
      if ((e as Error).name !== 'AbortError') {
        addAndPrint('error', formatError(e));
      }
    }

    busy = false;
    abortController = null;
    currentStreamWrap = null;
    process.stdout.write(ansi.cursorShow);
    rl.resume();
    prompt();
  }

  function prompt() {
    const spacing = getSetting('spacing') ?? 1;
    process.stdout.write('\n'.repeat(spacing));
    rl.setPrompt(dim('› '));
    rl.prompt();
  }

  process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
  updateTitle();
  addAndPrint('info', `ai ${version} [${currentModel}]`);
  addMessage('info', 'type /help for commands');
  out.write(`${dim('type /help for commands')}\n`);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', (_str, key) => {
    if (selectMode || busy || confirmMode) return;

    if (key?.name === 'escape') {
      commandMode = false;
      rl.setPrompt(dim('› '));
      rl.write(null, { ctrl: true, name: 'u' });
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
      return;
    }

    if (key?.name === 'up' || key?.name === 'down') {
      setImmediate(() => {
        const line = rl.line;
        if (line.startsWith('/') && !commandMode) {
          commandMode = true;
          const rest = line.slice(1);
          (rl as ReadlineInternal).line = rest;
          (rl as ReadlineInternal).cursor = rest.length;
          rl.setPrompt(dim('/ '));
          process.stdout.write(`\r${ansi.eraseLine}${dim('/ ')}${rest}`);
        } else if (!line.startsWith('/') && commandMode) {
          commandMode = false;
          rl.setPrompt(dim('› '));
          process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}${line}`);
        }
      });
    }
  });

  rl.on('line', handleInput);
  rl.on('close', cleanup);
  rl.on('SIGINT', () => {
    if (busy && abortController) {
      killRunningCommand();
      abortController.abort();
      abortController = null;
      busy = false;
      clearStatus();
      process.stdout.write(`\n${dim('cancelled')}\n`);
      process.stdout.write(ansi.cursorShow);
      rl.resume();
      prompt();
    } else {
      cleanup();
    }
  });

  prompt();
}
