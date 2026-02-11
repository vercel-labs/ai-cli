import ansi from 'ansi-escapes';
import { dim } from '../utils/color.js';

export interface InlineMenuOptions {
  /** Maximum number of items visible at once. Defaults to 8. */
  maxVisible?: number;
  /** Custom filter function. Defaults to prefix matching. */
  filter?: (item: string, query: string) => boolean;
}

/**
 * A reusable inline dropdown menu rendered below the current cursor line.
 *
 * The menu handles its own rendering (the suggestion list below the prompt)
 * but does NOT own the input line — the caller manages the prompt and text.
 *
 * Usage:
 *   const menu = new InlineMenu(items);
 *   menu.open('');          // show all items
 *   menu.setFilter('he');   // filter to matching items
 *   menu.moveDown();        // highlight next item
 *   menu.getSelected();     // get highlighted item text
 *   menu.close();           // erase the menu from screen
 */
export class InlineMenu {
  private items: string[];
  private filtered: string[] = [];
  private selectedIndex = 0;
  private lineCount = 0;
  private _isOpen = false;
  private maxVisible: number;
  private filterFn: (item: string, query: string) => boolean;

  constructor(items: string[], opts?: InlineMenuOptions) {
    this.items = items;
    this.maxVisible = opts?.maxVisible ?? 8;
    this.filterFn = opts?.filter ?? ((item, query) => item.startsWith(query));
  }

  /** Whether the menu is currently displayed. */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Replace the full item list (e.g. when available commands change). */
  setItems(items: string[]): void {
    this.items = items;
  }

  /** Show the menu, filtered by the given query. */
  open(query: string): void {
    this._isOpen = true;
    this.applyFilter(query);
    this.render();
  }

  /** Erase the menu from screen and reset state. */
  close(): void {
    this.clear();
    this._isOpen = false;
    this.selectedIndex = 0;
    this.filtered = [];
  }

  /** Update the filter text. Resets selection to 0 and re-renders. */
  setFilter(query: string): void {
    if (!this._isOpen) return;
    this.applyFilter(query);
    this.selectedIndex = 0;
    this.render();
  }

  /** Move selection up by one. */
  moveUp(): void {
    if (!this._isOpen || this.filtered.length === 0) return;
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.render();
  }

  /** Move selection down by one. */
  moveDown(): void {
    if (!this._isOpen || this.filtered.length === 0) return;
    this.selectedIndex = Math.min(
      this.filtered.length - 1,
      this.selectedIndex + 1,
    );
    this.render();
  }

  /** Get the currently highlighted item, or null if nothing matches. */
  getSelected(): string | null {
    if (this.filtered.length === 0) return null;
    return this.filtered[this.selectedIndex] ?? null;
  }

  /** Get the filtered item list. */
  getFiltered(): string[] {
    return this.filtered;
  }

  // ── internal ──────────────────────────────────────────────

  private applyFilter(query: string): void {
    if (!query) {
      this.filtered = this.items.slice();
    } else {
      this.filtered = this.items.filter((item) => this.filterFn(item, query));
    }
  }

  /**
   * Erase previously rendered suggestion lines.
   *
   * Uses relative cursor movement (cursorUp) instead of save/restore,
   * because save/restore uses absolute screen positions that break
   * when the terminal scrolls (e.g. prompt near the bottom of the screen).
   */
  private clear(): void {
    if (this.lineCount > 0) {
      for (let i = 0; i < this.lineCount; i++) {
        process.stdout.write(`\n${ansi.eraseLine}`);
      }
      // Move back up to the prompt row (relative — survives scrolling)
      process.stdout.write(ansi.cursorUp(this.lineCount) + '\r');
      this.lineCount = 0;
    }
  }

  /**
   * Render the suggestion list below the cursor.
   *
   * After rendering, the cursor is left at column 0 of the prompt row.
   * The caller should redraw the prompt line to reposition the cursor.
   */
  private render(): void {
    this.clear();

    if (this.filtered.length === 0) {
      this.lineCount = 0;
      return;
    }

    const total = this.filtered.length;
    const toShow = this.filtered.slice(0, this.maxVisible);

    for (let i = 0; i < toShow.length; i++) {
      const isSelected = i === this.selectedIndex;
      const label = toShow[i];
      if (isSelected) {
        process.stdout.write(`\n${ansi.eraseLine}  › ${label}`);
      } else {
        process.stdout.write(`\n${ansi.eraseLine}${dim(`    ${label}`)}`);
      }
    }

    if (total > this.maxVisible) {
      process.stdout.write(
        `\n${ansi.eraseLine}${dim(`    ... ${total - this.maxVisible} more`)}`,
      );
      this.lineCount = toShow.length + 1;
    } else {
      this.lineCount = toShow.length;
    }

    // Move back up to the prompt row (relative — survives scrolling)
    process.stdout.write(ansi.cursorUp(this.lineCount) + '\r');
  }
}
