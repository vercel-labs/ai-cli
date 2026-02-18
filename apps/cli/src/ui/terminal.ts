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
  loadChat,
  saveChat,
} from '../config/chats.js';
import { setModel as saveModel } from '../config/index.js';
import { getSetting } from '../config/settings.js';
import { streamChat, type TokenUsage } from '../hooks/chat.js';
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
import { InlineMenu } from './inline-menu.js';
import { Output } from './output.js';
import { SpacingController } from './spacing.js';

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
import {
  shimmerText,
  nextShimmerPos,
  SHIMMER_PADDING,
} from '../utils/shimmer.js';

const setTitle = (s: string) => process.stdout.write(`\x1b]0;${s}\x07`);

function trimLeadingBlankLines(text: string): string {
  return text.replace(/^(?:\r?\n)+/, '');
}

export async function terminal(
  model: string,
  version: string,
  resumeId?: string,
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
  let modelSelectMode = false;
  let modelBuffer = ''; // manual line buffer for model select mode
  const modelMenu = new InlineMenu([], {
    maxVisible: 10,
    filterAndSort: (items, query) =>
      items
        .map((id) => ({ id, score: scoreMatch(id, query) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.id),
  });
  let editStreamRendered = false;
  let editStreamLineCount = 0;
  let pendingImage: { data: string; mimeType: string } | null = null;
  let capabilities: ModelCapabilities = {
    vision: true,
    tools: true,
    reasoning: false,
  };

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
    rl.setPrompt(dim('› '));
    process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
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
      rl.setPrompt(dim('› '));
      (rl as ReadlineInternal).line = '';
      (rl as ReadlineInternal).cursor = 0;
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
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
      rl.setPrompt(dim('› '));
      (rl as ReadlineInternal).line = entry;
      (rl as ReadlineInternal).cursor = entry.length;
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}${entry}`);
    }
  }

  /** Enter model select mode with the given model list. */
  function enterModelSelectMode(models: string[]): void {
    modelSelectMode = true;
    modelBuffer = '';
    modelMenu.setItems(models);
    // Pre-select the current model if it's in the list
    modelMenu.open('');
    const idx = models.indexOf(currentModel);
    if (idx > 0) {
      for (let i = 0; i < idx; i++) modelMenu.moveDown();
    }
    redrawModelLine();
  }

  /** Exit model select mode, restore normal prompt. */
  function exitModelSelectMode(): void {
    modelSelectMode = false;
    modelBuffer = '';
    modelMenu.close();
    rl.setPrompt(dim('› '));
    process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
  }

  /** Redraw the model-select prompt line. */
  function redrawModelLine(): void {
    process.stdout.write(
      `\r${ansi.eraseLine}${dim('model › ')}${modelBuffer || dim('type to filter...')}`,
    );
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

        const options = opts?.noAlways
          ? ['yes', 'no']
          : ['yes', 'no', 'always'];
        let selected = 0;

        // Split multiline actions: write header/body once, re-render only options
        const actionLines = action.split('\n');
        const headerLine = actionLines[0];
        const bodyLines = actionLines.slice(1);
        const hasBody = bodyLines.length > 0;

        // Track how many lines the confirm UI occupies (excluding options line)
        let confirmLineCount = 0;
        if (editStreamRendered) {
          // Diff was already streamed to screen — just add spacing
          confirmLineCount = editStreamLineCount + 1; // streamed lines + blank
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
          confirmLineCount = 1; // header line
          if (hasBody) {
            for (const line of bodyLines) {
              lock.write(`  ${line}\n`);
            }
            lock.write('\n');
            confirmLineCount += bodyLines.length + 1; // body + blank
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

          if (accepted) {
            // Erase the confirm prompt entirely — the tool result will
            // describe what happened (e.g. "Ran ...", "Edited ...").
            lock.write(`\r${ansi.eraseLine}`); // clear options line
            for (let i = 0; i < confirmLineCount; i++) {
              lock.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
            }
            // Don't request another gap — the blank line originally
            // written by beforeStatus() is still in the terminal above
            // the cursor and serves as the one-line separator.
            spacing.markAfterConfirmAccepted();
          } else {
            lock.write(`\r${ansi.eraseLine}${dim(`› ${choice}`)}\n`);
            // Treat confirm choices like user messages for spacing.
            spacing.markAfterConfirm();
          }

          // Release lock BEFORE resolving so downstream writes render again
          confirmMode = false;
          lock.release();
          // If a status update was queued while the lock was held (e.g.
          // "Running …"), show it now so the user sees progress.
          if (accepted && pendingStatusText) {
            showStatus(pendingStatusText);
          }
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

    if (busy) {
      inputStream.write(chunk);
      return;
    }

    // ── Model select mode input (bypasses readline) ──
    if (modelSelectMode) {
      // Escape — cancel
      if (str === '\x1b' && str.length === 1) {
        exitModelSelectMode();
        prompt();
        return;
      }

      // Ctrl+C — cancel
      if (str === '\x03') {
        exitModelSelectMode();
        prompt();
        return;
      }

      // Backspace on empty — cancel
      if (modelBuffer === '' && (str === '\x7f' || str === '\b')) {
        exitModelSelectMode();
        prompt();
        return;
      }

      // Backspace — remove last char
      if (str === '\x7f' || str === '\b') {
        modelBuffer = modelBuffer.slice(0, -1);
        modelMenu.setFilter(modelBuffer);
        redrawModelLine();
        return;
      }

      // Up arrow — move selection up
      if (str === '\x1b[A') {
        modelMenu.moveUp();
        redrawModelLine();
        return;
      }

      // Down arrow — move selection down
      if (str === '\x1b[B') {
        modelMenu.moveDown();
        redrawModelLine();
        return;
      }

      // Tab — complete with selected
      if (str === '\t') {
        const selected = modelMenu.getSelected();
        if (selected) {
          modelBuffer = selected;
          modelMenu.setFilter(modelBuffer);
          redrawModelLine();
        }
        return;
      }

      // Enter — select model
      if (str === '\r' || str === '\n') {
        const selected = modelMenu.getSelected();
        modelMenu.close();
        modelSelectMode = false;
        modelBuffer = '';
        rl.setPrompt(dim('› '));

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
        return;
      }

      // Printable character — append to buffer
      if (str.length === 1 && str >= ' ') {
        modelBuffer += str;
        modelMenu.setFilter(modelBuffer);
        redrawModelLine();
        return;
      }

      // Ignore all other keys in model select mode
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
          rl.setPrompt(dim('› '));
          process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
          return;
        }

        const fullLine = `/${finalCmd}`;
        // Add to readline history so up-arrow recalls it
        (rl as ReadlineInternal).history.unshift(fullLine);
        (rl as ReadlineInternal).line = '';
        (rl as ReadlineInternal).cursor = 0;
        rl.setPrompt(dim('› '));
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
      rl.setPrompt(dim('› '));
      (rl as ReadlineInternal).line = '';
      (rl as ReadlineInternal).cursor = 0;
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
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
    if (busy || modelSelectMode || confirmMode) return;
    process.stdout.write(ansi.clearTerminal + ansi.cursorTo(0, 0));
    for (const msg of messages) {
      printMessage(msg);
    }
    const spacing = getSetting('spacing') ?? 1;
    process.stdout.write('\n'.repeat(spacing));
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

  function printMessage(msg: Message, trailing = true) {
    const markdown = getSetting('markdown');
    switch (msg.type) {
      case 'user': {
        const wrapped = wrap(msg.content);
        const userLines = wrapped.split('\n');
        const formatted = userLines
          .map((l, i) => (i === 0 ? `${dim('› ')}${l}` : `${dim('  ')}${l}`))
          .join('\n');
        out.write(`${formatted}\n${trailing ? '\n' : ''}`);
        break;
      }
      case 'assistant': {
        const assistant = trimLeadingBlankLines(msg.content);
        const content = markdown ? renderMarkdown(assistant) : assistant;
        out.write(`${wrap(mask(content))}\n`);
        break;
      }
      case 'tool': {
        const formatted = formatToolOutput(mask(msg.content));
        const nlIdx = formatted.indexOf('\n');
        if (nlIdx >= 0) {
          const header = formatted.slice(0, nlIdx);
          const body = formatted.slice(nlIdx + 1);
          out.write(`${dim(header)}\n${dimmer(body)}\n${trailing ? '\n' : ''}`);
        } else {
          out.write(`${dim(formatted)}\n${trailing ? '\n' : ''}`);
        }
        break;
      }
      case 'info': {
        const nlIdx = msg.content.indexOf('\n');
        const firstLine =
          nlIdx >= 0 ? msg.content.slice(0, nlIdx) : msg.content;
        out.write(`${dim(firstLine)}\n`);
        if (nlIdx >= 0) {
          // Body lines (e.g. diff from editFile) — preserve original colors
          out.write(`${msg.content.slice(nlIdx + 1)}\n`);
        }
        if (trailing) out.write('\n');
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

  async function handleInput(line: string) {
    if (modelSelectMode) return;

    let msg = line.trim();

    if (commandMode) {
      cmdMenu.close();
      commandMode = false;
      cmdBuffer = '';
      cmdFromHistory = false;
      cmdHistoryIdx = -1;
      rl.setPrompt(dim('› '));
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
      rl.setPrompt(dim('› '));
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
          const m = await fetchModels();
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
    spacing.markUserSubmit();
    const controller = new AbortController();
    abortController = controller;
    streamBuffer = '';
    const streamWrap = createStreamWrap();
    currentStreamWrap = streamWrap;

    process.stdout.write(ansi.cursorHide);
    rl.pause();

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
                printMessage({ type, content: normalizedContent }, false);
              }
              streamBuffer = '';
              streamWrap.reset();
            } else {
              printMessage({ type, content: normalizedContent }, false);
            }
            addMessage(type, normalizedContent);
            spacing.markAfterBareMessage();
          },
          onRecord: (type, content) => {
            const normalizedContent =
              type === 'assistant' ? trimLeadingBlankLines(content) : content;
            // Finalize stream wrap without re-rendering text
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
            addMessage(
              'info',
              `${label}${truncated ? `\n  ${truncated}` : ''}`,
            );
          },
          onEditStream: (filePath, oldLines, newLines, more) => {
            clearStatus();
            spacing.beforeOutput();

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
    rl.setPrompt(dim('› '));
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
      const display = resumed.display?.length
        ? resumed.display
        : resumed.messages.map((m) => ({
            type: m.role,
            content: m.content,
          }));
      const spacingSetting = getSetting('spacing') ?? 1;
      let lastType = '';
      for (let i = 0; i < display.length; i++) {
        const m = display[i];
        const isLast = i === display.length - 1;
        if (lastType === 'info' && m.type !== 'info') {
          process.stdout.write('\n'.repeat(spacingSetting));
        }
        addAndPrint(m.type as MessageType, m.content);
        if (!isLast && m.type !== 'user' && m.type !== 'info') {
          process.stdout.write('\n'.repeat(spacingSetting));
        }
        lastType = m.type;
      }
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
    if (modelSelectMode || busy || confirmMode) return;

    // Command mode handles its own input in the 'data' handler — skip here
    if (commandMode) return;

    if (key?.name === 'escape') {
      rl.setPrompt(dim('› '));
      rl.write(null, { ctrl: true, name: 'u' });
      process.stdout.write(`\r${ansi.eraseLine}${dim('› ')}`);
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
