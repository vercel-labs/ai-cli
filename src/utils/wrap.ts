export function wrap(text: string, width?: number): string {
  const cols = (width || process.stdout.columns || 80) - 1;
  const lines: string[] = [];

  for (const line of text.split('\n')) {
    if (line.length <= cols) {
      lines.push(line);
      continue;
    }

    const words = line.split(' ');
    let current = '';

    for (const word of words) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= cols) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.join('\n');
}

export function createStreamWrap() {
  let col = 0;
  let buffer = '';

  return {
    write(text: string): string {
      const cols = (process.stdout.columns || 80) - 1;
      let output = '';

      for (const char of text) {
        if (char === '\n') {
          output += `${buffer}\n`;
          buffer = '';
          col = 0;
          continue;
        }

        if (char === ' ') {
          const wordLen = buffer.length;
          if (col + wordLen > cols && col > 0) {
            output += `\n${buffer} `;
            col = wordLen + 1;
          } else {
            output += `${buffer} `;
            col += wordLen + 1;
          }
          buffer = '';
        } else {
          buffer += char;
        }
      }

      return output;
    },

    flush(): string {
      const out = buffer;
      buffer = '';
      col = 0;
      return out;
    },

    reset() {
      col = 0;
      buffer = '';
    },
  };
}
