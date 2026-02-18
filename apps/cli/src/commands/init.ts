import { dim } from '../utils/color.js';
import { setApiKey } from '../config/index.js';
import { GATEWAY_URL } from '../utils/models.js';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/credits`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    const onData = (char: string) => {
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(password);
          break;
        case '\u0003':
          stdin.setRawMode?.(false);
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007f':
        case '\u0008':
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          for (const c of char) {
            if (c >= ' ' && c <= '~') {
              password += c;
              process.stdout.write('*');
            }
          }
          break;
      }
    };

    stdin.on('data', onData);
  });
}

const KEY_URL =
  'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Go+to+AI+Gateway';

const hyperlink = (text: string, url: string) =>
  `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;

export async function initCommand(): Promise<void> {
  console.log(dim(`get key → ${hyperlink('vercel.com/ai', KEY_URL)}\n`));
  const apiKey = await readPassword(dim('› api key: '));

  if (!apiKey) {
    console.error('key required');
    process.exit(1);
  }

  let frame = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${dim(frames[frame])} ${dim('validating...')}`);
    frame = (frame + 1) % frames.length;
  }, 80);

  const isValid = await validateApiKey(apiKey);
  clearInterval(interval);
  process.stdout.write('\r\x1b[K');

  if (!isValid) {
    console.error('invalid key');
    process.exit(1);
  }

  try {
    setApiKey(apiKey);
    console.log(dim('saved'));
  } catch {
    console.error('failed to save');
    process.exit(1);
  }
}
