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
import type { Context } from '../commands/slash/types.js';
import type { Chat } from '../config/chats.js';
import {
  createChat,
  deleteAllChats,
  listChats,
  loadChat,
  saveChat,
} from '../config/chats.js';
import { setModel as saveModel } from '../config/index.js';
import {
  getReviewEnabled,
  getReviewMaxIterations,
  getSetting,
} from '../config/settings.js';
import {
  type StreamCallbacks,
  streamChat,
  type TokenUsage,
} from '../hooks/chat.js';
import { setConfirmHandler } from '../tools/confirm.js';
import { killRunningCommand } from '../tools/run-command.js';
import { getClipboardImage } from '../utils/clipboard.js';
import { dim, green, red } from '../utils/color.js';
import { formatError } from '../utils/errors.js';
import { mask } from '../utils/mask.js';
import {
  fetchModels,
  getModelCapabilities,
  type ModelCapabilities,
} from '../utils/models.js';
import { detectPackageManager } from '../utils/package-manager.js';
import { killAllProcesses } from '../utils/processes.js';
import { reviewLoop } from '../utils/review.js';
import {
  nextShimmerPos,
  SHIMMER_PADDING,
  shimmerText,
} from '../utils/shimmer.js';
import {
  getChangedFilesWithOriginals,
  hasChangedFiles,
} from '../utils/undo.js';
import { createStreamWrap } from '../utils/wrap.js';
import {
  getChatDisplay,
  type Message,
  type MessageType,
  printMessage,
  renderChatDisplay,
  trimLeadingBlankLines,
} from './chat-display.js';
import { createConfirmHandler } from './confirm-dialog.js';
import { InlineMenu } from './inline-menu.js';
import { ModelSelector } from './model-selector.js';
import { Output } from './output.js';
import { SpacingController } from './spacing.js';

interface ReadlineInternal extends readline.Interface {
  line: string;
  cursor: number;
  history: string[];
}

const setTitle = (s: string) => process.stdout.write(`\x1b]0;${s}\x07`);

interface TerminalOptions {
  planMode?: boolean;
  system?: string;
}

export async function terminal(
  model: string,
  version: string,
  resumeId?: string,
  options?: TerminalOptions,
): Promise<void> {
  const out = new Output();
  const spacing = new SpacingController((text) => out.write(text));

  let currentModel = model;
  let chat: Chat | null = null;
  const history: ModelMessage[] = [];
  const messages: Message[] = [];
  let tokens = 0;
  let cost = 0;
  const tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
  let summary = '';
  let busy = false;
  let abortController: AbortController | null = null;
  const pm = detectPackageManager();
  let statusText = '';
  let streamBuffer = '';
  let currentStreamWrap: ReturnType<typeof createStreamWrap> | null = null;
  let confirmMode = false;
  let commandMode = false;
  let cmdBuffer = ''; // manual line buffer for command mode (bypasses readline)
  let cmdFromHistory = false; // whether command mode was entered by history recall
  let cmdHistoryIdx = -1; // tracked position in readline history during history browsing
  let multilineLines: string[] = []; // accumulated lines for multiline input
  const cmdMenu = new InlineMenu([], {
    maxVisible: 8,
    filter: (item, query) => item.startsWith(query),
  });
  const modelSelector = new ModelSelector((text) => process.stdout.write(text));
  let editStreamRendered = false;
  let editStreamLineCount = 0;
  let planMode = options?.planMode ?? false;
  let pendingImage: { data: string; mimeType: string } | null = null;
  let capabilities: ModelCapabilities = {
    vision: true,
    tools: true,
    reasoning: false,
  };

  function promptStr(): string {
    return planMode ? 'plan › ' : '› ';
  }

  /** Populate the command menu with the current slash-command names. */
  function refreshCmdMenuItems(): void {
    const [completions] = getCompletions('/');
    cmdMenu.setItems(completions.map((c) => c.slice(1))); // strip leading /
  }

  /** Enter command mode: switch prompt, open the menu. */
  function enterCommandMode(): void {
    commandMode = true;
    cmdBuffer = '';
    rl.setPrompt(dim('/ '));
    refreshCmdMenuItems();
    cmdMenu.open('');
    redrawCmdLine();
  }

  /** Exit command mode: close menu, restore normal prompt. */
  function exitCommandMode(): void {
    commandMode = false;
    cmdBuffer = '';
    cmdFromHistory = false;
    cmdHistoryIdx = -1;
    cmdMenu.close();
    rl.setPrompt(dim(promptStr()));
    process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}`);
  }

  /** Redraw the command-mode prompt line (without touching readline). */
  function redrawCmdLine(): void {
    process.stdout.write(`\r${ansi.eraseLine}${dim('/ ')}${cmdBuffer}`);
  }

  /**
   * Navigate command history when in cmdFromHistory mode.
   * Up = older (higher index), Down = newer (lower index).
   */
  function navigateCmdHistory(direction: 'up' | 'down'): void {
    const hist = (rl as ReadlineInternal).history;
    const newIdx = direction === 'up' ? cmdHistoryIdx + 1 : cmdHistoryIdx - 1;

    // Down past newest entry → exit to empty prompt
    if (newIdx < 0) {
      commandMode = false;
      cmdFromHistory = false;
      cmdBuffer = '';
      cmdHistoryIdx = -1;
      cmdMenu.close();
      rl.setPrompt(dim(promptStr()));
      (rl as ReadlineInternal).line = '';
      (rl as ReadlineInternal).cursor = 0;
      process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}`);
      return;
    }

    // No more history
    if (newIdx >= hist.length) return;

    cmdHistoryIdx = newIdx;
    const entry = hist[newIdx];

    if (entry.startsWith('/')) {
      // Stay in command mode, update buffer
      cmdBuffer = entry.slice(1);
      redrawCmdLine();
    } else {
      // Exit command mode, show non-slash entry in normal mode
      // Keep cmdFromHistory and cmdHistoryIdx for continued navigation
      commandMode = false;
      cmdBuffer = '';
      cmdMenu.close();
      rl.setPrompt(dim(promptStr()));
      (rl as ReadlineInternal).line = entry;
      (rl as ReadlineInternal).cursor = entry.length;
      process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}${entry}`);
    }
  }

  function enterModelSelectMode(models: string[]): void {
    modelSelector.enter(models, currentModel);
  }

  function exitModelSelectMode(): void {
    modelSelector.exit();
    rl.setPrompt(dim(promptStr()));
    process.stdout.write(`${dim(promptStr())}`);
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
    prompt: dim(promptStr()),
    terminal: true,
    escapeCodeTimeout: 50,
    completer: (line: string) => getCompletions(line),
  });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  setConfirmHandler(
    createConfirmHandler({
      out,
      spacing,
      stdin: process.stdin,
      getCwd: () => process.cwd(),
      getEditStreamState: () => ({
        rendered: editStreamRendered,
        lineCount: editStreamLineCount,
      }),
      resetEditStreamState: () => {
        editStreamRendered = false;
        editStreamLineCount = 0;
      },
      setConfirmMode: (mode) => {
        confirmMode = mode;
      },
      flushStream: () => {
        clearStatus();
        if (streamBuffer && currentStreamWrap) {
          const remaining = currentStreamWrap.flush();
          if (remaining) out.write(remaining);
          streamBuffer = '';
          currentStreamWrap.reset();
          out.write('\n');
        }
      },
      getPendingStatusText: () => pendingStatusText,
      showStatus,
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

    if (busy) {
      inputStream.write(chunk);
      return;
    }

    // ── Model select mode input (bypasses readline) ──
    if (modelSelector.active) {
      const result = modelSelector.handleInput(str);
      if (result === 'cancel') {
        exitModelSelectMode();
        prompt();
      } else if (result === 'select') {
        const selected = modelSelector.getSelected();
        exitModelSelectMode();

        if (selected && selected !== currentModel) {
          process.stdout.write(`\r${ansi.eraseLine}`);
          saveModel(selected);
          currentModel = selected;
          updateCapabilities(selected).then(() => {
            updateTitle();
            addAndPrint('info', `switched to ${selected}`);
            prompt();
          });
        } else if (selected) {
          process.stdout.write(`\r${ansi.eraseLine}`);
          addAndPrint('info', `already using ${selected}`);
          prompt();
        } else {
          process.stdout.write(`\r${ansi.eraseLine}`);
          prompt();
        }
      }
      return;
    }

    if (str === '\x16') {
      if (!capabilities.vision) {
        process.stdout.write(
          '\r' +
            ansi.eraseLine +
            dim(promptStr()) +
            dim('[model does not support images]'),
        );
        setTimeout(() => {
          process.stdout.write(
            `\r${ansi.eraseLine}${dim(promptStr())}${(rl as ReadlineInternal).line}`,
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
        const prefix = commandMode ? '/ ' : promptStr();
        process.stdout.write(`\r${ansi.eraseLine}${dim(prefix)}${newLine}`);
      }
      return;
    }

    // ── Enter command mode when / is typed on an empty line ──
    if (
      !commandMode &&
      multilineLines.length === 0 &&
      rl.line === '' &&
      str === '/'
    ) {
      enterCommandMode();
      return;
    }

    // ── All command-mode input is handled here (bypasses readline) ──
    if (commandMode) {
      // Escape — exit command mode
      if (str === '\x1b' && str.length === 1) {
        pendingImage = null;
        (rl as ReadlineInternal).line = '';
        (rl as ReadlineInternal).cursor = 0;
        exitCommandMode();
        return;
      }

      // Backspace on empty buffer — exit command mode
      if (cmdBuffer === '' && (str === '\x7f' || str === '\b')) {
        exitCommandMode();
        return;
      }

      // Backspace — remove last char
      if (str === '\x7f' || str === '\b') {
        if (cmdFromHistory) {
          cmdFromHistory = false;
          cmdHistoryIdx = -1;
          refreshCmdMenuItems();
        }
        cmdBuffer = cmdBuffer.slice(0, -1);
        if (!cmdMenu.isOpen) {
          cmdMenu.open(cmdBuffer);
        } else {
          cmdMenu.setFilter(cmdBuffer);
        }
        redrawCmdLine();
        return;
      }

      // Up arrow — move selection up or navigate history
      if (str === '\x1b[A') {
        if (cmdFromHistory) {
          navigateCmdHistory('up');
        } else {
          cmdMenu.moveUp();
          redrawCmdLine();
        }
        return;
      }

      // Down arrow — move selection down or navigate history
      if (str === '\x1b[B') {
        if (cmdFromHistory) {
          navigateCmdHistory('down');
        } else {
          cmdMenu.moveDown();
          redrawCmdLine();
        }
        return;
      }

      // Tab — complete with selected item
      if (str === '\t') {
        if (cmdFromHistory) {
          cmdFromHistory = false;
          cmdHistoryIdx = -1;
          refreshCmdMenuItems();
          cmdMenu.open(cmdBuffer);
        }
        const selected = cmdMenu.getSelected();
        if (selected) {
          cmdBuffer = `${selected} `;
          cmdMenu.setFilter(cmdBuffer.trimEnd());
        }
        redrawCmdLine();
        return;
      }

      // Enter — submit the command
      if (str === '\r' || str === '\n') {
        // Use the selected menu item if available, otherwise use typed text
        const selected = cmdMenu.getSelected();
        const finalCmd = (selected ?? cmdBuffer).trimEnd();
        cmdMenu.close();
        commandMode = false;
        cmdBuffer = '';
        cmdFromHistory = false;
        cmdHistoryIdx = -1;

        if (!finalCmd) {
          rl.setPrompt(dim(promptStr()));
          process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}`);
          return;
        }

        const fullLine = `/${finalCmd}`;
        // Add to readline history so up-arrow recalls it
        (rl as ReadlineInternal).history.unshift(fullLine);
        (rl as ReadlineInternal).line = '';
        (rl as ReadlineInternal).cursor = 0;
        rl.setPrompt(dim(promptStr()));
        process.stdout.write(`\r${ansi.eraseLine}${dim('/ ')}${finalCmd}\n`);
        handleInput(fullLine);
        return;
      }

      // Ctrl+C — exit
      if (str === '\x03') {
        exitCommandMode();
        return;
      }

      // Printable character — append to buffer
      if (str.length === 1 && str >= ' ') {
        if (cmdFromHistory) {
          cmdFromHistory = false;
          cmdHistoryIdx = -1;
          refreshCmdMenuItems();
        }
        cmdBuffer += str;
        if (!cmdMenu.isOpen) {
          cmdMenu.open(cmdBuffer);
        } else {
          cmdMenu.setFilter(cmdBuffer);
        }
        redrawCmdLine();
        return;
      }

      // Ignore all other keys (arrows left/right, etc.) in command mode
      return;
    }

    // ── Normal mode (not command mode) ──

    if (str === '\x1b' && str.length === 1) {
      if (multilineLines.length > 0) {
        for (let i = 0; i < multilineLines.length; i++) {
          process.stdout.write(ansi.cursorUp(1) + ansi.eraseLine);
        }
        multilineLines = [];
      }
      pendingImage = null;
      rl.setPrompt(dim(promptStr()));
      (rl as ReadlineInternal).line = '';
      (rl as ReadlineInternal).cursor = 0;
      process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}`);
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

    // Don't submit empty input
    if (
      str === '\r' &&
      multilineLines.length === 0 &&
      (rl as ReadlineInternal).line.trim() === ''
    ) {
      return;
    }

    // Ctrl+C during multiline → cancel multiline input
    if (str === '\x03' && multilineLines.length > 0) {
      for (let i = 0; i < multilineLines.length; i++) {
        process.stdout.write(ansi.cursorUp(1) + ansi.eraseLine);
      }
      multilineLines = [];
      rl.setPrompt(dim(promptStr()));
      (rl as ReadlineInternal).line = '';
      (rl as ReadlineInternal).cursor = 0;
      process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}`);
      return;
    }

    // Backspace at start of line in multiline → merge with previous committed line
    if (
      (str === '\x7f' || str === '\b') &&
      multilineLines.length > 0 &&
      (rl as ReadlineInternal).cursor === 0
    ) {
      const internal = rl as ReadlineInternal;
      const prevLine = multilineLines.pop() ?? '';
      const currentLine = internal.line;
      const merged = prevLine + currentLine;
      // Erase the current readline line, then move up and erase the committed line
      process.stdout.write(`\r${ansi.eraseLine}`);
      process.stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}\r`);
      // Update readline state with merged content
      internal.line = merged;
      internal.cursor = prevLine.length;
      const prefix = multilineLines.length === 0 ? '› ' : '  ';
      rl.setPrompt(dim(prefix));
      // Render merged line and position cursor at the join point
      process.stdout.write(`${dim(prefix)}${merged}`);
      if (currentLine.length > 0) {
        process.stdout.write(ansi.cursorBackward(currentLine.length));
      }
      return;
    }

    // Ctrl+J / Alt+Enter / Shift+Enter (kitty) → add line to multiline buffer
    if (str === '\n' || str === '\x1b\r' || str === '\x1b[13;2u') {
      const internal = rl as ReadlineInternal;
      const currentLine = internal.line;
      multilineLines.push(currentLine);
      // Erase readline's rendered line and rewrite as committed
      process.stdout.write(`\r${ansi.eraseLine}`);
      const prefix = multilineLines.length === 1 ? '› ' : '  ';
      process.stdout.write(`${dim(prefix)}${currentLine}\n`);
      // Reset readline for the next line
      internal.line = '';
      internal.cursor = 0;
      rl.setPrompt(dim('  '));
      process.stdout.write(dim('  '));
      return;
    }

    // ── History browsing override in normal mode ──
    // When we navigated from a slash command to a non-slash entry via
    // cmdFromHistory, keep intercepting up/down for continued history browsing.
    if (cmdFromHistory && (str === '\x1b[A' || str === '\x1b[B')) {
      // Re-enter command mode context for navigateCmdHistory
      navigateCmdHistory(str === '\x1b[A' ? 'up' : 'down');
      return;
    }

    // Any other input clears the history browsing override
    if (cmdFromHistory) {
      cmdFromHistory = false;
      cmdHistoryIdx = -1;
    }

    inputStream.write(chunk);
  });

  let cleaningUp = false;
  function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }
  function cleanup() {
    if (cleaningUp) return;
    cleaningUp = true;
    killAllProcesses();
    process.stdout.write(`\n${ansi.cursorShow}`);
    if (tokens > 0) {
      const { inputTokens, outputTokens, cacheReadTokens } = tokenUsage;
      let input = formatTokenCount(inputTokens);
      if (cacheReadTokens > 0) {
        input += ` (${formatTokenCount(cacheReadTokens)} cached)`;
      }
      process.stdout.write(
        `${dim(`total: ${input} input · ${formatTokenCount(outputTokens)} output`)}\n`,
      );
    }
    if (chat?.id && chat.messages.length > 0) {
      process.stdout.write(
        `${dim(`session: ${chat.id} — resume with`)} ai --resume ${chat.id}\n`,
      );
    }
    rl.close();
    process.exit(0);
  }

  function redraw() {
    if (busy || modelSelector.active || confirmMode) return;
    process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
    for (const msg of messages) {
      renderMessage(msg);
    }
    const spacingLines = getSetting('spacing') ?? 1;
    process.stdout.write('\n'.repeat(spacingLines));
    rl.prompt();
  }

  process.stdout.on('resize', redraw);

  let shimmerTimer: ReturnType<typeof setInterval> | null = null;
  let shimmerPos = -SHIMMER_PADDING;
  /** Status text queued while the output was locked (e.g. during a confirm). */
  let pendingStatusText: string | null = null;

  function clearStatus() {
    pendingStatusText = null;
    if (shimmerTimer) {
      clearInterval(shimmerTimer);
      shimmerTimer = null;
    }
    if (statusText) {
      out.write(ansi.cursorUp(1) + ansi.eraseLine + ansi.cursorLeft);
      statusText = '';
    }
  }

  function showStatus(text: string) {
    // If the output is locked (e.g. a confirm modal owns the terminal),
    // queue the status for later — writing through out.write() would be
    // silently dropped, and the shimmerTimer would fire after the lock
    // is released and corrupt cursor positions.
    if (out.locked) {
      pendingStatusText = text;
      return;
    }
    pendingStatusText = null;
    const hadStatus = Boolean(statusText);
    if (hadStatus) {
      // Text update only — keep shimmer position flowing
      statusText = text;
      return;
    }
    // New status line — set up spacing and start the timer.
    // Don't reset shimmerPos: let it continue flowing across
    // clearStatus/showStatus cycles so the animation never restarts.
    spacing.beforeStatus();
    out.write(`${shimmerText(text, shimmerPos)}\n`);
    statusText = text;

    shimmerTimer = setInterval(() => {
      if (!statusText) return;
      shimmerPos = nextShimmerPos(shimmerPos, statusText.length);
      out.write(ansi.cursorUp(1) + ansi.eraseLine + ansi.cursorLeft);
      out.write(`${shimmerText(statusText, shimmerPos)}\n`);
    }, 50);
  }

  const write = (text: string) => out.write(text);

  function renderMessage(msg: Message, trailing = true) {
    printMessage(msg, write, trailing);
  }

  function addMessage(type: MessageType, content: string) {
    messages.push({ type, content });
  }

  function addAndPrint(type: MessageType, content: string) {
    addMessage(type, content);
    renderMessage({ type, content });
  }

  function restoreDisplay(display: { type: string; content: string }[]): void {
    renderChatDisplay(
      display,
      (text) => process.stdout.write(text),
      addAndPrint,
    );
  }

  function waitForPlanConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      spacing.beforeOutput();
      out.write(`${dim('execute plan? (y/n) ')}`);
      confirmMode = true;
      const onData = (chunk: Buffer) => {
        const ch = chunk.toString().toLowerCase();
        if (ch === 'y' || ch === '\r' || ch === '\n') {
          confirmMode = false;
          process.stdin.removeListener('data', onData);
          out.write('y\n');
          resolve(true);
        } else if (ch === 'n' || ch === '\x1b' || ch === '\x03') {
          confirmMode = false;
          process.stdin.removeListener('data', onData);
          out.write('n\n');
          resolve(false);
        }
      };
      process.stdin.on('data', onData);
    });
  }

  async function runReview(
    msg: string,
    cbs: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!getReviewEnabled()) return;
    if (!hasChangedFiles()) return;

    const changed = getChangedFilesWithOriginals();
    if (changed.length === 0) return;

    try {
      await reviewLoop({
        model: currentModel,
        originalTask: msg,
        changedFiles: changed,
        maxIterations: getReviewMaxIterations(),
        callbacks: cbs,
        abortSignal: signal,
        pm,
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        addAndPrint('error', formatError(e));
      }
    }
  }

  async function handleInput(line: string) {
    if (modelSelector.active) return;

    let msg = line.trim();

    if (commandMode) {
      cmdMenu.close();
      commandMode = false;
      cmdBuffer = '';
      cmdFromHistory = false;
      cmdHistoryIdx = -1;
      rl.setPrompt(dim(promptStr()));
      if (msg) {
        msg = `/${msg}`;
        (rl as ReadlineInternal).history.unshift(msg);
      }
    }

    // Combine with any accumulated multiline lines
    const wasMultiline = multilineLines.length > 0;
    if (wasMultiline) {
      msg = [...multilineLines, line].join('\n').trim();
      multilineLines = [];
      rl.setPrompt(dim(promptStr()));
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

    if (msg.startsWith('/') && !wasMultiline) {
      const parts = msg.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      if ((cmd === 'model' || cmd === 'm') && !args) {
        process.stdout.write(dim('loading models...\n'));
        try {
          const m = await fetchModels(true);
          const models = m.map((x) => x.id);
          // Erase the "loading models..." line before showing the menu
          process.stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}\r`);
          enterModelSelectMode(models);
        } catch {
          addAndPrint('info', 'failed to load models');
          prompt();
        }
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
        tokenUsage,
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
        if (res.planMode !== undefined) {
          planMode = !planMode;
          addAndPrint('info', planMode ? 'plan mode on' : 'plan mode off');
        }
        if (res.chat && cmd === 'chat' && res.chat) {
          summary = res.chat.summary || '';
          restoreHistory({ chat: res.chat }, history);
          process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
          messages.length = 0;
          restoreDisplay(getChatDisplay(res.chat));
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
    spacing.markUserSubmit();
    const controller = new AbortController();
    abortController = controller;
    streamBuffer = '';
    const streamWrap = createStreamWrap();
    currentStreamWrap = streamWrap;

    process.stdout.write(ansi.cursorHide);
    rl.pause();

    function makeCallbacks(): StreamCallbacks {
      return {
        onStatus: (s) => {
          if (s) {
            if (!statusText && streamBuffer) {
              const remaining = streamWrap.flush();
              out.write(`${remaining}\n`);
              streamBuffer = '';
              spacing.markAfterBareMessage();
            }
            showStatus(s);
          } else {
            clearStatus();
          }
        },
        onPending: (text) => {
          const normalized = trimLeadingBlankLines(text);
          if (normalized.length > streamBuffer.length) {
            clearStatus();
            if (!streamBuffer) {
              spacing.beforeOutput();
            }
            const newText = normalized.slice(streamBuffer.length);
            const wrapped = streamWrap.write(mask(newText));
            out.write(wrapped);
            streamBuffer = normalized;
          }
        },
        onMessage: (type, content) => {
          clearStatus();
          spacing.beforeOutput();
          const normalizedContent =
            type === 'assistant' ? trimLeadingBlankLines(content) : content;
          if (type === 'assistant') {
            if (streamBuffer) {
              const remaining = streamWrap.flush();
              out.write(`${remaining}\n`);
            } else {
              renderMessage({ type, content: normalizedContent }, false);
            }
            streamBuffer = '';
            streamWrap.reset();
          } else {
            renderMessage({ type, content: normalizedContent }, false);
          }
          addMessage(type, normalizedContent);
          spacing.markAfterBareMessage();
        },
        onRecord: (type, content) => {
          const normalizedContent =
            type === 'assistant' ? trimLeadingBlankLines(content) : content;
          if (type === 'assistant' && streamBuffer) {
            const remaining = streamWrap.flush();
            if (remaining) out.write(remaining);
            out.write('\n');
            streamBuffer = '';
            streamWrap.reset();
            spacing.markAfterBareMessage();
          }
          addMessage(type, normalizedContent);
        },
        onReasoning: (text, durationMs) => {
          clearStatus();
          spacing.beforeOutput();
          const seconds = Math.round(durationMs / 1000);
          const label =
            seconds > 0 ? `thought for ${seconds}s` : 'thought briefly';
          const truncated = text.replace(/\s+/g, ' ').trim().slice(0, 80);
          out.write(`${dim(label)}\n`);
          if (truncated) out.write(`${dim(`  ${truncated}`)}\n`);
          spacing.markAfterBareMessage();
          addMessage('info', `${label}${truncated ? `\n  ${truncated}` : ''}`);
        },
        onEditStream: (filePath, oldLines, newLines, more) => {
          clearStatus();
          spacing.beforeOutput();

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
        onUsage: (u) => {
          tokenUsage.inputTokens += u.inputTokens;
          tokenUsage.outputTokens += u.outputTokens;
          tokenUsage.cacheReadTokens += u.cacheReadTokens;
          tokenUsage.cacheWriteTokens += u.cacheWriteTokens;
          tokenUsage.reasoningTokens += u.reasoningTokens;
        },
        onSummary: (s) => {
          summary = s;
        },
        onBusy: (b) => {
          busy = b;
        },
      };
    }

    try {
      const updatedChat = await streamChat({
        model: currentModel,
        message: msg,
        history,
        chat,
        tokens,
        summary,
        pm,
        callbacks: makeCallbacks(),
        abortSignal: controller.signal,
        image: pendingImage,
        hasTools: capabilities.tools,
        planMode,
        appendSystem: options?.system,
      });

      if (planMode && !controller.signal.aborted) {
        process.stdout.write(ansi.cursorShow);
        const confirmed = await waitForPlanConfirm();
        process.stdout.write(ansi.cursorHide);

        if (confirmed) {
          streamBuffer = '';
          streamWrap.reset();
          busy = true;

          const execChat = await streamChat({
            model: currentModel,
            message: 'Execute the plan above. Proceed step by step.',
            history,
            chat: updatedChat,
            tokens,
            summary,
            pm,
            callbacks: makeCallbacks(),
            abortSignal: controller.signal,
            hasTools: capabilities.tools,
            appendSystem: options?.system,
          });

          pendingImage = null;
          chat = execChat;
          execChat.display = messages.map((m) => ({
            type: m.type,
            content: m.content,
          }));
          execChat.tokens = tokens;
          execChat.cost = cost;
          saveChat(execChat);

          if (!controller.signal.aborted) {
            await runReview(msg, makeCallbacks(), controller.signal);
          }
        } else {
          addAndPrint('info', 'plan discarded');
          pendingImage = null;
          chat = updatedChat;
          updatedChat.display = messages.map((m) => ({
            type: m.type,
            content: m.content,
          }));
          updatedChat.tokens = tokens;
          updatedChat.cost = cost;
          saveChat(updatedChat);
        }
      } else {
        pendingImage = null;
        chat = updatedChat;
        updatedChat.display = messages.map((m) => ({
          type: m.type,
          content: m.content,
        }));
        updatedChat.tokens = tokens;
        updatedChat.cost = cost;
        saveChat(updatedChat);

        if (!controller.signal.aborted) {
          await runReview(msg, makeCallbacks(), controller.signal);
        }
      }
    } catch (e) {
      clearStatus();
      if ((e as Error).name !== 'AbortError') {
        spacing.beforeOutput();
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
    const promptSpacing = getSetting('spacing') ?? 1;
    process.stdout.write('\n'.repeat(promptSpacing));
    rl.setPrompt(dim(promptStr()));
    rl.prompt();
  }

  updateTitle();

  if (resumeId) {
    const resumed = loadChat(resumeId);
    if (resumed) {
      chat = resumed;
      summary = resumed.summary || '';
      tokens = resumed.tokens || 0;
      cost = resumed.cost || 0;
      if (resumed.model) {
        currentModel = resumed.model;
        await updateCapabilities(resumed.model);
      }
      restoreHistory({ chat: resumed }, history);
      restoreDisplay(getChatDisplay(resumed));
      updateTitle();
    } else {
      addAndPrint('info', `ai ${version} [${currentModel}]`);
      addAndPrint('error', `session ${resumeId} not found`);
    }
  } else {
    addAndPrint('info', `ai ${version} [${currentModel}]`);
    addMessage('info', 'type /help for commands · ctrl+j for newline');
    out.write(`${dim('type /help for commands · ctrl+j for newline')}\n`);
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', (_str, key) => {
    if (modelSelector.active || busy || confirmMode) return;

    // Command mode handles its own input in the 'data' handler — skip here
    if (commandMode) return;

    if (key?.name === 'escape') {
      rl.setPrompt(dim(promptStr()));
      rl.write(null, { ctrl: true, name: 'u' });
      process.stdout.write(`\r${ansi.eraseLine}${dim(promptStr())}`);
      return;
    }

    // When history recalls a /command, enter command mode (without menu)
    if (key?.name === 'up' || key?.name === 'down') {
      setImmediate(() => {
        const line = rl.line;
        if (line.startsWith('/') && !commandMode) {
          commandMode = true;
          cmdFromHistory = true;
          cmdBuffer = line.slice(1);
          // Find our position in the history array
          const hist = (rl as ReadlineInternal).history;
          cmdHistoryIdx = hist.indexOf(line);
          (rl as ReadlineInternal).line = '';
          (rl as ReadlineInternal).cursor = 0;
          rl.setPrompt(dim('/ '));
          // Do NOT open the menu — keep it hidden for history recall
          redrawCmdLine();
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
