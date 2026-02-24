import arg from 'arg';
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { inkCommand } from './commands/ink.js';
import { listModels } from './commands/models.js';
import { printCommand } from './commands/print.js';
import { getApiKey, getModel } from './config/index.js';
import { getSetting } from './config/settings.js';
import { DEFAULT_MODEL } from './utils/constants.js';
import { readStdin, showHelp } from './utils/index.js';
import { resolveModel } from './utils/models.js';

declare const __VERSION__: string;
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.2';

interface Args {
  '--model'?: string;
  '--help'?: boolean;
  '--version'?: boolean;
  '--list'?: boolean;
  '--image'?: string;
  '--no-color'?: boolean;
  '--resume'?: string;
  '--plan'?: boolean;
  '--print'?: boolean;
  '--json'?: boolean;
  '--system'?: string;
  '--force'?: boolean;
  '--no-save'?: boolean;
  _: string[];
}

async function main() {
  let args: Args;
  try {
    args = arg({
      '--model': String,
      '--help': Boolean,
      '--version': Boolean,
      '--list': Boolean,
      '--image': String,
      '--no-color': Boolean,
      '--resume': String,
      '--plan': Boolean,
      '--print': Boolean,
      '--json': Boolean,
      '--system': String,
      '--force': Boolean,
      '--no-save': Boolean,
      '-m': '--model',
      '-h': '--help',
      '-v': '--version',
      '-l': '--list',
      '-r': '--resume',
      '-p': '--print',
    }) as Args;
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(err.message);
      process.exit(1);
    }
    console.error('unknown error');
    process.exit(1);
  }

  if (args['--no-color']) {
    process.env.NO_COLOR = '1';
  }

  if (args['--version']) {
    console.log(version);
    process.exit(0);
  }

  if (args['--help']) {
    showHelp(version);
    process.exit(0);
  }

  if (args['--list']) {
    await listModels();
    process.exit(0);
  }

  const settingsModel = getSetting('model');
  const savedModel = getModel() || settingsModel || DEFAULT_MODEL;

  if (args._.includes('init')) {
    await initCommand();
    const apiKey = getApiKey();
    if (apiKey && process.stdin.isTTY) {
      process.env.AI_GATEWAY_API_KEY = apiKey;
      globalThis.AI_SDK_LOG_WARNINGS = false;
      console.log();
      await inkCommand({ model: savedModel, version });
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
  const model = modelArg ? await resolveModel(modelArg) : savedModel;

  if (args['--resume'] && process.stdin.isTTY) {
    await inkCommand({
      model,
      version,
      resume: args['--resume'],
      planMode: args['--plan'],
    });
    return;
  }

  const headless = args['--print'] || args['--json'];

  let message = args._.join(' ');

  if (!message) {
    if (!process.stdin.isTTY) {
      message = await readStdin();
    }

    if (!message) {
      if (!headless && process.stdin.isTTY) {
        await inkCommand({
          model,
          version,
          planMode: args['--plan'],
        });
        return;
      }
      console.error('no message');
      process.exit(1);
    }
  }

  if (headless) {
    await printCommand({
      message,
      model,
      image: args['--image'],
      json: args['--json'],
      force: args['--force'],
      save: !args['--no-save'],
      system: args['--system'],
      version,
    });
    return;
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
