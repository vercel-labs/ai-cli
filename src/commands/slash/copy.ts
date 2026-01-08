import { spawn } from 'node:child_process';
import type { CommandHandler } from './types.js';

function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = process.platform === 'darwin'
      ? spawn('pbcopy')
      : process.platform === 'win32'
        ? spawn('clip')
        : spawn('xclip', ['-selection', 'clipboard']);

    proc.stdin?.write(text);
    proc.stdin?.end();

    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export const copy: CommandHandler = async (ctx) => {
  if (!ctx.chat || ctx.chat.messages.length === 0) {
    return { output: 'no messages to copy' };
  }

  const lastAssistant = [...ctx.chat.messages]
    .reverse()
    .find((m) => m.role === 'assistant');

  if (!lastAssistant) {
    return { output: 'no assistant response to copy' };
  }

  const success = await copyToClipboard(lastAssistant.content);
  return { output: success ? 'copied to clipboard' : 'failed to copy' };
};
