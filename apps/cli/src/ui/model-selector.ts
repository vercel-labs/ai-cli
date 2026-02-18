import ansi from 'ansi-escapes';
import { dim } from '../utils/color.js';
import { scoreMatch } from '../utils/models.js';
import { InlineMenu } from './inline-menu.js';

export class ModelSelector {
  active = false;
  buffer = '';
  private write: (text: string) => void;
  private menu = new InlineMenu([], {
    maxVisible: 10,
    filterAndSort: (items, query) =>
      items
        .map((id) => ({ id, score: scoreMatch(id, query) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.id),
  });

  constructor(write?: (text: string) => void) {
    this.write = write ?? process.stdout.write.bind(process.stdout);
  }

  enter(models: string[], currentModel: string): void {
    this.active = true;
    this.buffer = '';
    this.menu.setItems(models);
    this.menu.open('');
    const idx = models.indexOf(currentModel);
    if (idx > 0) {
      for (let i = 0; i < idx; i++) this.menu.moveDown();
    }
    this.redraw();
  }

  exit(): void {
    this.active = false;
    this.buffer = '';
    this.menu.close();
  }

  getSelected(): string | null {
    return this.menu.getSelected();
  }

  handleInput(str: string): 'cancel' | 'select' | 'handled' {
    if (str === '\x1b' && str.length === 1) return 'cancel';
    if (str === '\x03') return 'cancel';

    if (this.buffer === '' && (str === '\x7f' || str === '\b')) {
      return 'cancel';
    }

    if (str === '\x7f' || str === '\b') {
      this.buffer = this.buffer.slice(0, -1);
      this.menu.setFilter(this.buffer);
      this.redraw();
      return 'handled';
    }

    if (str === '\x1b[A') {
      this.menu.moveUp();
      this.redraw();
      return 'handled';
    }

    if (str === '\x1b[B') {
      this.menu.moveDown();
      this.redraw();
      return 'handled';
    }

    if (str === '\t') {
      const selected = this.menu.getSelected();
      if (selected) {
        this.buffer = selected;
        this.menu.setFilter(this.buffer);
        this.redraw();
      }
      return 'handled';
    }

    if (str === '\r' || str === '\n') {
      return 'select';
    }

    if (str.length === 1 && str >= ' ') {
      this.buffer += str;
      this.menu.setFilter(this.buffer);
      this.redraw();
      return 'handled';
    }

    return 'handled';
  }

  private redraw(): void {
    this.write(
      `\r${ansi.eraseLine}${dim('model › ')}${this.buffer || dim('type to filter...')}`,
    );
  }
}
