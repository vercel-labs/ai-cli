import arg from 'arg';
import consola from 'consola';
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { getApiKey } from './config/index.js';
import { readStdin, showHelp } from './utils/index.js';

// @ts-ignore - defined by esbuild
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.1';

interface Args {
  '--model'?: string;
  '--help'?: boolean;
  _: string[];
}

async function main() {
  let args: Args;
  try {
    args = arg({
      '--model': String,
      '--help': Boolean,
      '-m': '--model',
      '-h': '--help',
    }) as Args;
  } catch (err: unknown) {
    if (err instanceof Error) {
      consola.error(err.message);
      process.exit(1);
    }
    consola.error('unknown error');
    process.exit(1);
  }

  if (args['--help']) {
    showHelp();
    process.exit(0);
  }

  if (args._.includes('init')) {
    await initCommand();
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    consola.error('no key. run: ai init');
    process.exit(1);
  }

  process.env.AI_GATEWAY_API_KEY = apiKey;

  let message = args._.join(' ');

  if (!message) {
    if (!process.stdin.isTTY) {
      message = await readStdin();
    }

    if (!message) {
      consola.error('no message');
      process.exit(1);
    }
  }

  await chatCommand({
    message,
    model: args['--model'],
    isPiped: !process.stdout.isTTY,
    version,
  });
}

main().catch((error) => {
  consola.error('error:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
