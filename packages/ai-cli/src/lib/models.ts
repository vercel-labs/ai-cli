import { gateway } from "ai";

export type Modality = "text" | "image" | "video";

const DEFAULTS: Record<Modality, string> = {
  text: process.env.AI_CLI_TEXT_MODEL ?? "openai/gpt-5.5",
  image: process.env.AI_CLI_IMAGE_MODEL ?? "openai/gpt-image-2",
  video: process.env.AI_CLI_VIDEO_MODEL ?? "bytedance/seedance-2.0",
};

export const FALLBACK_TEXT_MODELS = [
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "meta/llama-4-maverick",
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-5.5",
  "openai/o3",
  "openai/o4-mini",
  "xai/grok-3",
];

export const FALLBACK_IMAGE_MODELS = [
  "bfl/flux-2-flex",
  "bfl/flux-2-klein-4b",
  "bfl/flux-2-klein-9b",
  "bfl/flux-2-max",
  "bfl/flux-2-pro",
  "bfl/flux-kontext-max",
  "bfl/flux-kontext-pro",
  "bfl/flux-pro-1.0-fill",
  "bfl/flux-pro-1.1",
  "bfl/flux-pro-1.1-ultra",
  "bytedance/seedream-4.0",
  "bytedance/seedream-4.5",
  "bytedance/seedream-5.0-lite",
  "google/imagen-4.0-fast-generate-001",
  "google/imagen-4.0-generate-001",
  "google/imagen-4.0-ultra-generate-001",
  "openai/gpt-image-1",
  "openai/gpt-image-1-mini",
  "openai/gpt-image-1.5",
  "openai/gpt-image-2",
  "prodia/flux-fast-schnell",
  "recraft/recraft-v2",
  "recraft/recraft-v3",
  "recraft/recraft-v4",
  "recraft/recraft-v4-pro",
  "xai/grok-imagine-image",
  "xai/grok-imagine-image-pro",
];

export const FALLBACK_VIDEO_MODELS = [
  "alibaba/wan-v2.5-t2v-preview",
  "alibaba/wan-v2.6-i2v",
  "alibaba/wan-v2.6-i2v-flash",
  "alibaba/wan-v2.6-r2v",
  "alibaba/wan-v2.6-r2v-flash",
  "alibaba/wan-v2.6-t2v",
  "bytedance/seedance-2.0",
  "bytedance/seedance-2.0-fast",
  "bytedance/seedance-v1.0-lite-i2v",
  "bytedance/seedance-v1.0-lite-t2v",
  "bytedance/seedance-v1.0-pro",
  "bytedance/seedance-v1.0-pro-fast",
  "bytedance/seedance-v1.5-pro",
  "google/veo-3.0-fast-generate-001",
  "google/veo-3.0-generate-001",
  "google/veo-3.1-fast-generate-001",
  "google/veo-3.1-generate-001",
  "klingai/kling-v2.5-turbo-i2v",
  "klingai/kling-v2.5-turbo-t2v",
  "klingai/kling-v2.6-i2v",
  "klingai/kling-v2.6-motion-control",
  "klingai/kling-v2.6-t2v",
  "klingai/kling-v3.0-i2v",
  "klingai/kling-v3.0-t2v",
  "xai/grok-imagine-video",
];

export interface ModelEntry {
  id: string;
  name?: string;
  description?: string;
}

export interface GatewayModels {
  text: ModelEntry[];
  image: ModelEntry[];
  video: ModelEntry[];
}

const MODEL_TYPE_TO_MODALITY: Record<string, Modality> = {
  language: "text",
  image: "image",
  video: "video",
};

export async function fetchGatewayModels(): Promise<GatewayModels> {
  const result: GatewayModels = { text: [], image: [], video: [] };

  try {
    const { models } = await gateway.getAvailableModels();
    for (const m of models) {
      const modality =
        MODEL_TYPE_TO_MODALITY[(m as { modelType?: string }).modelType ?? ""];
      if (!modality) continue;
      result[modality].push({
        id: m.id,
        name: m.name,
        description: m.description ?? undefined,
      });
    }
  } catch {
    result.text = FALLBACK_TEXT_MODELS.map((id) => ({ id }));
    result.image = FALLBACK_IMAGE_MODELS.map((id) => ({ id }));
    result.video = FALLBACK_VIDEO_MODELS.map((id) => ({ id }));
  }

  if (result.text.length === 0) {
    result.text = FALLBACK_TEXT_MODELS.map((id) => ({ id }));
  }
  if (result.image.length === 0) {
    result.image = FALLBACK_IMAGE_MODELS.map((id) => ({ id }));
  }
  if (result.video.length === 0) {
    result.video = FALLBACK_VIDEO_MODELS.map((id) => ({ id }));
  }

  return result;
}

function expandModelId(input: string, modality: Modality): string {
  if (input.includes("/")) return input;

  const knownLists: string[][] = [];
  if (modality === "text") knownLists.push(FALLBACK_TEXT_MODELS);
  else if (modality === "image") knownLists.push(FALLBACK_IMAGE_MODELS);
  else if (modality === "video") knownLists.push(FALLBACK_VIDEO_MODELS);

  for (const list of knownLists) {
    for (const fullId of list) {
      const name = fullId.slice(fullId.indexOf("/") + 1);
      if (name === input) return fullId;
    }
  }

  return input;
}

export function resolveModels(
  modality: Modality,
  userModel?: string
): string[] {
  if (!userModel) return [DEFAULTS[modality]];
  const models = userModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => expandModelId(m, modality));
  return models.length > 0 ? models : [DEFAULTS[modality]];
}
