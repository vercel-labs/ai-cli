import { stepCountIs, streamText } from 'ai';
import { getTools } from '../tools/index.js';
import { gray } from '../utils/color.js';
import { AI_CLI_HEADERS, DEFAULT_MODEL } from '../utils/constants.js';
import { formatError } from '../utils/errors.js';
import { loadImage } from '../utils/image.js';
import { createSpinner } from '../utils/spinner.js';

interface ChatOptions {
  message: string;
  model?: string;
  image?: string;
  isPiped: boolean;
  fast?: boolean;
  version: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const {
    message,
    model = DEFAULT_MODEL,
    image,
    isPiped,
    fast,
    version,
  } = options;

  if (!isPiped) {
    console.log(gray(`ai ${version} [${model}]`));
  }

  let imageData: { type: 'image'; image: string; mimeType: string } | null =
    null;
  if (image) {
    try {
      const img = loadImage(image);
      imageData = { type: 'image', image: img.data, mimeType: img.mimeType };
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
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
        openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' },
        ...(fast && { anthropic: { speed: 'fast' } }),
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
