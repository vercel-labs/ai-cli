import {
  gateway,
  type LanguageModel,
  type ImageModel,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { fal } from "@ai-sdk/fal";

export type Backend = "vercel" | "openrouter" | "openai" | "fal";

export interface Provider {
  backend: Backend;
  text: (modelId: string) => LanguageModel;
  image: (modelId: string) => ImageModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  video: ((modelId: string) => any) | null;
}

export function detectBackend(): Backend {
  const explicit = process.env.AI_PROVIDER as Backend | undefined;
  if (explicit) return explicit;

  if (process.env.AI_GATEWAY_API_KEY) return "vercel";
  if (process.env.FAL_KEY && process.env.OPENROUTER_API_KEY) return "openrouter"; // openrouter handles text; fal handles media
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.FAL_KEY) return "fal";
  if (process.env.OPENAI_API_KEY) return "openai";

  process.stderr.write(
    [
      "Error: no API key found. Set one of:",
      "  AI_GATEWAY_API_KEY   — Vercel AI Gateway (text + image + video, 100+ models)",
      "  OPENROUTER_API_KEY   — OpenRouter (text, 300+ models)",
      "  FAL_KEY              — fal.ai (image + video)",
      "  OPENAI_API_KEY       — OpenAI direct (text + DALL-E image)",
      "  OPENROUTER_API_KEY + FAL_KEY — text via OpenRouter, image/video via fal.ai",
      "",
    ].join("\n")
  );
  process.exit(1);
}

export function createProvider(): Provider {
  const backend = detectBackend();

  // ── Vercel AI Gateway (default, all capabilities) ──────────────────────────
  if (backend === "vercel") {
    return {
      backend,
      text: (id) => gateway(id),
      image: (id) => gateway.image(id),
      video: (id) => gateway.video(id),
    };
  }

  // ── OpenRouter (text only; pair with FAL_KEY for image/video) ──────────────
  if (backend === "openrouter") {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY!,
      headers: {
        "HTTP-Referer": "https://github.com/vercel-labs/ai-cli",
        "X-Title": "ai-cli",
      },
    });

    // If user also has FAL_KEY, route image/video to fal.ai automatically
    const hasFal = Boolean(process.env.FAL_KEY);

    return {
      backend,
      text: (id) => openrouter(id) as LanguageModel,
      image: hasFal
        ? (id) => fal.image(id)
        : () => {
            process.stderr.write(
              "Error: image generation requires FAL_KEY. Set FAL_KEY to use fal.ai for images, or use AI_GATEWAY_API_KEY for all-in-one access.\n"
            );
            process.exit(1);
          },
      video: hasFal
        ? (id) => fal.video(id)
        : null,
    };
  }

  // ── fal.ai (image + video; no text) ────────────────────────────────────────
  if (backend === "fal") {
    return {
      backend,
      text: () => {
        process.stderr.write(
          "Error: text generation requires OPENROUTER_API_KEY or AI_GATEWAY_API_KEY. fal.ai handles image/video only.\n"
        );
        process.exit(1);
      },
      image: (id) => fal.image(id),
      video: (id) => fal.video(id),
    };
  }

  // ── OpenAI direct (text + DALL-E image; no video) ──────────────────────────
  if (backend === "openai") {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    return {
      backend,
      text: (id) => openai(id),
      image: (id) => openai.image(id),
      video: null,
    };
  }

  process.stderr.write(`Error: unknown backend "${backend}"\n`);
  process.exit(1);
}
