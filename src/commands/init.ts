import consola from 'consola';
import { setApiKey } from '../config/index.js';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      'https://ai-gateway.vercel.sh/v1/ai/language-model',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'ai-gateway-protocol-version': '0.0.1',
          'ai-model-id': 'openai/gpt-4o-mini',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
          maxTokens: 1,
        }),
      },
    );
    return response.status !== 401;
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

export async function initCommand(): Promise<void> {
  const apiKey = await readPassword('► api key: ');

  if (!apiKey) {
    consola.error('key required');
    process.exit(1);
  }

  let frame = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${spinnerFrames[frame]} validating...`);
    frame = (frame + 1) % spinnerFrames.length;
  }, 80);

  const isValid = await validateApiKey(apiKey);
  clearInterval(interval);
  process.stdout.write('\r\x1b[K');

  if (!isValid) {
    consola.error('invalid key');
    process.exit(1);
  }

  try {
    setApiKey(apiKey);
    consola.success('saved');
  } catch (_error) {
    consola.error('failed to save');
    process.exit(1);
  }
}
