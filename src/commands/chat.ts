import { streamText } from 'ai';
import ora from 'ora';
import { dim, gray } from 'yoctocolors';

interface ChatOptions {
  message: string;
  model?: string;
  isPiped: boolean;
  version: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const { message, model = 'openai/gpt-5', isPiped, version } = options;

  if (!isPiped) {
    console.log(gray(`ai ${version} [${model}]`));
  }

  try {
    let thinkingBuffer = '';
    let hasSeenContent = false;
    let spinner: ReturnType<typeof ora> | null = null;

    if (!isPiped) {
      spinner = ora({
        text: dim('Thinking...'),
        color: 'gray',
        spinner: 'dots',
      }).start();
    }

    const result = streamText({
      model: model,
      prompt: message,
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
          reasoningSummary: 'detailed',
        },
      },
      headers: {
        'HTTP-Referer': 'https://www.npmjs.com/package/ai-cli',
        'X-Title': 'ai-cli',
      },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta' && part.text) {
        thinkingBuffer += part.text;

        if (spinner && thinkingBuffer) {
          const cleaned = thinkingBuffer.replace(/\s+/g, ' ').trim();
          const termWidth = process.stdout.columns || 80;
          const maxWidth = termWidth - 4;

          if (cleaned.length <= maxWidth) {
            spinner.text = dim(cleaned);
          } else {
            const start = Math.max(0, cleaned.length - maxWidth);
            const window = cleaned.substring(start, start + maxWidth);
            spinner.text = dim(window);
          }
        }
      } else if (part.type === 'text-delta') {
        if (!hasSeenContent) {
          hasSeenContent = true;
          if (spinner) {
            spinner.stop();
            spinner = null;
          }
        }
        process.stdout.write(part.text);
      }
    }

    if (spinner) {
      spinner.stop();
    }

    if (!isPiped) {
      console.log();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('authentication')) {
      console.error('invalid key. run: ai init');
    } else {
      console.error('error');
    }
    process.exit(1);
  }
}
