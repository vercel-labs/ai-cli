import type { CommandHandler } from './types.js';

export const version: CommandHandler = (ctx) => {
  const link = '\x1b]8;;https://x.com/nishimiya\x07@nishimiya\x1b]8;;\x07';
  const lines = [
    `ai v${ctx.version}`,
    '',
    `model:    ${ctx.model}`,
    `node:     ${process.version}`,
    `platform: ${process.platform} ${process.arch}`,
    '',
    `feedback: ${link}`,
  ];
  return { output: lines.join('\n') };
};
