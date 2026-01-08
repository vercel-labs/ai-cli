import arg from 'arg';
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { interactiveCommand } from './commands/interactive.js';
import { listModels } from './commands/models.js';
import { getApiKey, getModel } from './config/index.js';
import { readStdin, showHelp } from './utils/index.js';
import { resolveModel } from './utils/models.js';

// @ts-ignore - defined by esbuild
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.2';

interface Args {
  '--model'?: string;
  '--help'?: boolean;
  '--list'?: boolean;
  '--image'?: string;
  _: string[];
}

async function main() {
  let args: Args;
  try {
    args = arg({
      '--model': String,
      '--help': Boolean,
      '--list': Boolean,
      '--image': String,
      '-m': '--model',
      '-h': '--help',
      '-l': '--list',
    }) as Args;
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(err.message);
      process.exit(1);
    }
    console.error('unknown error');
    process.exit(1);
  }

  if (args['--help']) {
    showHelp();
    process.exit(0);
  }

  if (args['--list']) {
    await listModels();
    process.exit(0);
  }

  const defaultModel = 'anthropic/claude-sonnet-4.5';
  const savedModel = getModel();

  if (args._.includes('init')) {
    await initCommand();
    const apiKey = getApiKey();
    if (apiKey && process.stdin.isTTY) {
      process.env.AI_GATEWAY_API_KEY = apiKey;
      globalThis.AI_SDK_LOG_WARNINGS = false;
      console.log();
      await interactiveCommand({ model: savedModel || defaultModel, version });
    }
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('no key. run: ai init');
    process.exit(1);
  }

  process.env.AI_GATEWAY_API_KEY = apiKey;
  globalThis.AI_SDK_LOG_WARNINGS = false;

  const modelArg = args['--model'];
  const model = modelArg
    ? await resolveModel(modelArg)
    : savedModel || defaultModel;

  let message = args._.join(' ');

  if (!message) {
    if (!process.stdin.isTTY) {
      message = await readStdin();
    }

    if (!message) {
      if (process.stdin.isTTY) {
        await interactiveCommand({
          model,
          version,
        });
        return;
      }
      console.error('no message');
      process.exit(1);
    }
  }

  await chatCommand({
    message,
    model,
    image: args['--image'],
    isPiped: !process.stdout.isTTY,
    version,
  });
}

main().catch((error) => {
  console.error('error:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
