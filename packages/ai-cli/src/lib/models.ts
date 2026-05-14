import { type Backend } from "./provider.js";

export type Modality = "text" | "image" | "video";

const DEFAULTS: Record<Backend, Record<Modality, string>> = {
  vercel: {
    text: process.env.AI_CLI_TEXT_MODEL ?? "openai/gpt-5.5",
    image: process.env.AI_CLI_IMAGE_MODEL ?? "openai/gpt-image-2",
    video: process.env.AI_CLI_VIDEO_MODEL ?? "bytedance/seedance-2.0",
  },
  openrouter: {
    text: process.env.AI_CLI_TEXT_MODEL ?? "openai/gpt-4o",
    image: process.env.AI_CLI_IMAGE_MODEL ?? "fal-ai/flux-pro",
    video: process.env.AI_CLI_VIDEO_MODEL ?? "fal-ai/kling-video/v2.1/standard/text-to-video",
  },
  openai: {
    text: process.env.AI_CLI_TEXT_MODEL ?? "gpt-4o",
    image: process.env.AI_CLI_IMAGE_MODEL ?? "dall-e-3",
    video: "",
  },
  fal: {
    text: "",
    image: process.env.AI_CLI_IMAGE_MODEL ?? "fal-ai/flux-pro",
    video: process.env.AI_CLI_VIDEO_MODEL ?? "fal-ai/kling-video/v2.1/standard/text-to-video",
  },
};

export interface ModelPricing {
  input?: string;
  output?: string;
  image?: string;
}

export interface ModelEntry {
  id: string;
  name?: string;
  description?: string;
  creator: string;
  capabilities: Modality[];
  pricing?: ModelPricing;
}

export interface GatewayModels {
  text: ModelEntry[];
  image: ModelEntry[];
  video: ModelEntry[];
  all: ModelEntry[];
  languageImageModelIds: Set<string>;
}

// fal.ai does not expose a unified model list endpoint; we maintain popular models here.
const FAL_MODELS: ModelEntry[] = [
  { id: "fal-ai/flux-pro", name: "FLUX Pro", creator: "fal-ai", capabilities: ["image"] },
  { id: "fal-ai/flux/schnell", name: "FLUX Schnell (fast)", creator: "fal-ai", capabilities: ["image"] },
  { id: "fal-ai/flux/dev", name: "FLUX Dev", creator: "fal-ai", capabilities: ["image"] },
  { id: "fal-ai/flux-realism", name: "FLUX Realism", creator: "fal-ai", capabilities: ["image"] },
  { id: "fal-ai/stable-diffusion-v3-medium", name: "SD3 Medium", creator: "fal-ai", capabilities: ["image"] },
  { id: "fal-ai/aura-flow", name: "AuraFlow", creator: "fal-ai", capabilities: ["image"] },
  { id: "fal-ai/kling-video/v2.1/standard/text-to-video", name: "Kling v2.1 T2V", creator: "fal-ai", capabilities: ["video"] },
  { id: "fal-ai/kling-video/v2.1/standard/image-to-video", name: "Kling v2.1 I2V", creator: "fal-ai", capabilities: ["video"] },
  { id: "fal-ai/wan-t2v-v1.3", name: "Wan T2V", creator: "fal-ai", capabilities: ["video"] },
  { id: "fal-ai/hunyuan-video", name: "HunyuanVideo", creator: "fal-ai", capabilities: ["video"] },
  { id: "fal-ai/runway-gen3/turbo/text-to-video", name: "Runway Gen3 Turbo T2V", creator: "fal-ai", capabilities: ["video"] },
];

const OPENAI_MODELS: ModelEntry[] = [
  { id: "gpt-4o", name: "GPT-4o", creator: "openai", capabilities: ["text"] },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", creator: "openai", capabilities: ["text"] },
  { id: "gpt-4.1", name: "GPT-4.1", creator: "openai", capabilities: ["text"] },
  { id: "o3", name: "o3", creator: "openai", capabilities: ["text"] },
  { id: "o4-mini", name: "o4-mini", creator: "openai", capabilities: ["text"] },
  { id: "dall-e-3", name: "DALL-E 3", creator: "openai", capabilities: ["image"] },
  { id: "dall-e-2", name: "DALL-E 2", creator: "openai", capabilities: ["image"] },
  { id: "gpt-image-1", name: "GPT Image 1", creator: "openai", capabilities: ["image"] },
];

let cached: Promise<GatewayModels> | null = null;
let cachedBackend: Backend | null = null;

export function resetGatewayCache(): void {
  cached = null;
  cachedBackend = null;
}

export function fetchGatewayModels(backend: Backend = "vercel"): Promise<GatewayModels> {
  if (!cached || cachedBackend !== backend) {
    cachedBackend = backend;
    cached = doFetch(backend).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

function buildFromList(models: ModelEntry[]): GatewayModels {
  const result: GatewayModels = {
    text: [],
    image: [],
    video: [],
    all: [...models],
    languageImageModelIds: new Set(),
  };
  for (const m of models) {
    if (m.capabilities.includes("text")) result.text.push(m);
    if (m.capabilities.includes("image")) result.image.push(m);
    if (m.capabilities.includes("video")) result.video.push(m);
  }
  return result;
}

interface RawModel {
  id: string;
  name?: string;
  description?: string;
  owned_by?: string;
  type?: string;
  tags?: string[];
  architecture?: { modality?: string };
  pricing?: { input?: string; output?: string; image?: string };
}

async function doFetch(backend: Backend): Promise<GatewayModels> {
  if (backend === "fal") return buildFromList(FAL_MODELS);
  if (backend === "openai") return buildFromList(OPENAI_MODELS);

  const url =
    backend === "openrouter"
      ? "https://openrouter.ai/api/v1/models"
      : "https://ai-gateway.vercel.sh/v1/models";

  const authHeader =
    backend === "openrouter"
      ? `Bearer ${process.env.OPENROUTER_API_KEY}`
      : `Bearer ${process.env.AI_GATEWAY_API_KEY}`;

  const result: GatewayModels = {
    text: [],
    image: [],
    video: [],
    all: [],
    languageImageModelIds: new Set(),
  };

  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: RawModel[] };
    const models = json.data ?? [];
    const entryMap = new Map<string, ModelEntry>();

    for (const m of models) {
      const tags = m.tags ?? [];
      const isImageGen = tags.includes("image-generation");
      const capabilities: Modality[] = [];

      if (backend === "openrouter") {
        const modality = m.architecture?.modality ?? "";
        if (modality.includes("image") || modality.includes("vision")) {
          capabilities.push("text");
        } else {
          capabilities.push("text");
        }
      } else {
        switch (m.type) {
          case "language":
            capabilities.push("text");
            if (isImageGen) capabilities.push("image");
            break;
          case "image":
            capabilities.push("image");
            break;
          case "video":
            capabilities.push("video");
            break;
          default:
            continue;
        }
      }

      const creator = m.owned_by ?? (m.id.slice(0, Math.max(0, m.id.indexOf("/"))) || "other");
      const pricing: ModelPricing | undefined =
        m.pricing?.input || m.pricing?.output || m.pricing?.image
          ? {
              ...(m.pricing?.input ? { input: m.pricing.input } : {}),
              ...(m.pricing?.output ? { output: m.pricing.output } : {}),
              ...(m.pricing?.image ? { image: m.pricing.image } : {}),
            }
          : undefined;

      const entry: ModelEntry = { id: m.id, name: m.name, description: m.description, creator, capabilities, pricing };
      entryMap.set(m.id, entry);

      if (capabilities.includes("text")) result.text.push(entry);
      if (capabilities.includes("image")) result.image.push(entry);
      if (capabilities.includes("video")) result.video.push(entry);
      if (m.type === "language" && isImageGen) result.languageImageModelIds.add(m.id);
    }

    result.all = [...entryMap.values()];
  } catch {
    cached = null;
    process.stderr.write(
      `Warning: could not fetch model list from ${backend === "openrouter" ? "OpenRouter" : "Vercel AI Gateway"}\n`
    );
  }

  // When using openrouter + fal together, add fal models to the image/video lists
  if (backend === "openrouter" && process.env.FAL_KEY) {
    for (const m of FAL_MODELS) {
      result.all.push(m);
      if (m.capabilities.includes("image")) result.image.push(m);
      if (m.capabilities.includes("video")) result.video.push(m);
    }
  }

  return result;
}

export function resolveModels(
  modality: Modality,
  userModel: string | undefined,
  knownModels: Pick<ModelEntry, "id">[] | undefined,
  backend: Backend = "vercel"
): string[] {
  const defaultModel = DEFAULTS[backend][modality];
  if (!userModel) {
    if (!defaultModel) {
      process.stderr.write(
        `Error: ${modality} generation is not supported with the "${backend}" backend.\n`
      );
      process.exit(1);
    }
    return [defaultModel];
  }
  const models = userModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => expandModelId(m, knownModels));
  return models.length > 0 ? models : [defaultModel];
}

function expandModelId(input: string, knownModels?: Pick<ModelEntry, "id">[]): string {
  if (input.includes("/")) return input;
  if (!knownModels) return input;
  for (const m of knownModels) {
    const name = m.id.slice(m.id.indexOf("/") + 1);
    if (name === input) return m.id;
  }
  return input;
}
