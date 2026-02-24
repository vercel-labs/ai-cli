import { isColorEnabled } from './color.js';
import { shimmerText, nextShimmerPos, SHIMMER_PADDING } from './shimmer.js';

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

export function createSpinner(
  stream: { write(s: string): boolean; columns?: number } = process.stdout,
) {
  let pos = -SHIMMER_PADDING;
  let text = '';
  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let startTime = 0;

  const getColumns = (): number =>
    stream.columns ?? process.stderr.columns ?? process.stdout.columns ?? 80;

  const render = () => {
    if (!running) return;
    const elapsed = formatElapsed(Date.now() - startTime);
    const termWidth = getColumns();
    const suffix = ` ${elapsed}`;
    const maxWidth = termWidth - 1 - suffix.length;
    const display = text.length > maxWidth ? text.slice(-maxWidth) : text;
    const fullText = `${display}${suffix}`;

    if (isColorEnabled()) {
      stream.write(`\r${shimmerText(fullText, pos)}\x1b[K`);
    } else {
      stream.write(`\r${fullText}\x1b[K`);
    }

    pos = nextShimmerPos(pos, fullText.length);
  };

  return {
    start(initialText = '') {
      if (running) return;
      text = initialText;
      startTime = Date.now();
      pos = -SHIMMER_PADDING;
      running = true;
      render();
      interval = setInterval(render, 50);
    },
    update(newText: string) {
      text = newText.replace(/\s+/g, ' ').trim();
    },
    stop() {
      if (!running) return;
      running = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      stream.write('\r\x1b[K');
    },
  };
}
