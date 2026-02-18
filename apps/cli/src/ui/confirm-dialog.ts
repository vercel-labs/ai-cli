import ansi from 'ansi-escapes';
import { dim } from '../utils/color.js';
import { addRule } from '../utils/permissions.js';
import type { SpacingController } from './spacing.js';

interface ConfirmDeps {
  out: { write(text: string): void; lock(): Lock | null };
  spacing: SpacingController;
  stdin: {
    // biome-ignore lint/suspicious/noExplicitAny: Node EventEmitter callback signatures vary
    on(event: string, listener: (...args: any[]) => void): void;
    // biome-ignore lint/suspicious/noExplicitAny: Node EventEmitter callback signatures vary
    removeListener(event: string, listener: (...args: any[]) => void): void;
  };
  getCwd: () => string;
  getEditStreamState: () => { rendered: boolean; lineCount: number };
  resetEditStreamState: () => void;
  setConfirmMode: (mode: boolean) => void;
  flushStream: () => void;
  getPendingStatusText: () => string | null;
  showStatus: (text: string) => void;
}

interface Lock {
  write(text: string): void;
  release(): void;
}

export type ConfirmHandler = (
  action: string,
  opts?: { tool?: string; command?: string; noAlways?: boolean },
) => Promise<boolean>;

export function createConfirmHandler(deps: ConfirmDeps): ConfirmHandler {
  return (action, opts) =>
    new Promise<boolean>((resolve) => {
      deps.flushStream();

      const lock = deps.out.lock();
      if (!lock) {
        resolve(false);
        return;
      }
      deps.setConfirmMode(true);

      const options = opts?.noAlways ? ['yes', 'no'] : ['yes', 'no', 'always'];
      let selected = 0;

      const actionLines = action.split('\n');
      const headerLine = actionLines[0];
      const bodyLines = actionLines.slice(1);
      const hasBody = bodyLines.length > 0;

      let confirmLineCount = 0;
      const editState = deps.getEditStreamState();
      if (editState.rendered) {
        confirmLineCount = editState.lineCount + 1;
        deps.resetEditStreamState();
        lock.write('\n');
      } else {
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
        confirmLineCount = 1;
        if (hasBody) {
          for (const line of bodyLines) {
            lock.write(`  ${line}\n`);
          }
          lock.write('\n');
          confirmLineCount += bodyLines.length + 1;
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
        deps.stdin.removeListener('keypress', onKey);
        const accepted = choice === 'yes' || choice === 'always';

        if (accepted) {
          lock.write(`\r${ansi.eraseLine}`);
          for (let i = 0; i < confirmLineCount; i++) {
            lock.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
          }
          deps.spacing.markAfterConfirmAccepted();
        } else {
          lock.write(`\r${ansi.eraseLine}${dim(`› ${choice}`)}\n`);
          deps.spacing.markAfterConfirm();
        }

        deps.setConfirmMode(false);
        lock.release();
        const pending = deps.getPendingStatusText();
        if (accepted && pending) {
          deps.showStatus(pending);
        }
        if (choice === 'always') {
          if (opts?.tool) {
            addRule(opts.tool, deps.getCwd(), opts.command);
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

      deps.stdin.on('keypress', onKey);
    });
}
