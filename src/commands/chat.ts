import * as fs from 'node:fs';
import * as path from 'node:path';
import { stepCountIs, streamText } from 'ai';
import { gray } from '../utils/color.js';
import { getTools } from '../tools/index.js';
import { AI_CLI_HEADERS } from '../utils/constants.js';
import { formatError } from '../utils/errors.js';
import { createSpinner } from '../utils/spinner.js';

interface ChatOptions {
  message: string;
  model?: string;
  image?: string;
  isPiped: boolean;
  version: string;
}

const imageTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function getMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return imageTypes[ext] || null;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const {
    message,
    model = 'anthropic/claude-sonnet-4.5',
    image,
    isPiped,
    version,
  } = options;

  if (!isPiped) {
    console.log(gray(`ai ${version} [${model}]`));
  }

  let imageData: { type: 'image'; image: string; mimeType: string } | null =
    null;
  if (image) {
    const resolved = path.resolve(image);
    if (!fs.existsSync(resolved)) {
      console.error(`image not found: ${image}`);
      process.exit(1);
    }
    const mimeType = getMimeType(resolved);
    if (!mimeType) {
      console.error('unsupported format. use: png, jpg, gif, webp');
      process.exit(1);
    }
    const buffer = fs.readFileSync(resolved);
    imageData = {
      type: 'image',
      image: buffer.toString('base64'),
      mimeType,
    };
  }

  const spinner = !isPiped ? createSpinner() : null;
  let hasSeenContent = false;
  let reasoning = '';

  try {
    spinner?.start('thinking...');

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string; mimeType: string }
    > = [{ type: 'text', text: message }];
    if (imageData) content.unshift(imageData);

    const result = streamText({
      model: model,
      system:
        'You are a helpful CLI assistant. Output plain text only - no markdown formatting, no emojis. Be concise. Always use TypeScript (not JavaScript) unless told otherwise.',
      messages: [{ role: 'user', content }],
      tools: getTools(),
      stopWhen: stepCountIs(5),
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
          reasoningSummary: 'detailed',
        },
      },
      headers: AI_CLI_HEADERS,
      onError: () => {},
    });

    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta' && part.text) {
        reasoning += part.text;
        spinner?.update(reasoning);
      } else if (part.type === 'tool-call') {
        spinner?.update(`${part.toolName}...`);
      } else if (part.type === 'text-delta') {
        if (!hasSeenContent) {
          hasSeenContent = true;
          spinner?.stop();
        }
        process.stdout.write(part.text);
      }
    }

    if (!hasSeenContent) spinner?.stop();

    if (!isPiped) {
      console.log();
    }
  } catch (error) {
    spinner?.stop();
    console.error(formatError(error));
    process.exit(1);
  }
}
