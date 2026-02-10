import { dim } from 'yoctocolors';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

export function createSpinner() {
  let frame = 0;
  let text = '';
  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let startTime = 0;

  const render = () => {
    if (!running) return;
    const elapsed = formatElapsed(Date.now() - startTime);
    const termWidth = process.stdout.columns || 80;
    const suffix = ` (${elapsed})`;
    const maxWidth = termWidth - 4 - suffix.length;
    const display = text.length > maxWidth ? text.slice(-maxWidth) : text;
    process.stdout.write(
      `\r${dim(frames[frame])} ${dim(display + suffix)}\x1b[K`,
    );
    frame = (frame + 1) % frames.length;
  };

  return {
    start(initialText = '') {
      if (running) return;
      text = initialText;
      startTime = Date.now();
      running = true;
      render();
      interval = setInterval(render, 80);
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
      process.stdout.write('\r\x1b[K');
    },
  };
}
