export type Modality = "text" | "image" | "video";

const DEFAULTS: Record<Modality, string> = {
  text: process.env.AI_CLI_TEXT_MODEL ?? "openai/gpt-5.5",
  image: process.env.AI_CLI_IMAGE_MODEL ?? "openai/gpt-image-2",
  video: process.env.AI_CLI_VIDEO_MODEL ?? "bytedance/seedance-2.0",
};

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const GATEWAY_TIMEOUT_MS = 5_000;

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

interface RawGatewayModel {
  id: string;
  name?: string;
  description?: string;
  owned_by?: string;
  type?: string;
  tags?: string[];
  pricing?: {
    input?: string;
    output?: string;
    image?: string;
  };
}

let cached: Promise<GatewayModels> | null = null;

export function fetchGatewayModels(): Promise<GatewayModels> {
  if (!cached) cached = doFetch();
  return cached;
}

export function resetGatewayCache(): void {
  cached = null;
}

async function doFetch(): Promise<GatewayModels> {
  const result: GatewayModels = {
    text: [],
    image: [],
    video: [],
    all: [],
    languageImageModelIds: new Set(),
  };

  try {
    const res = await fetch(GATEWAY_MODELS_URL, {
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: RawGatewayModel[] };
    const models = json.data ?? [];

    const entryMap = new Map<string, ModelEntry>();

    for (const m of models) {
      const tags = m.tags ?? [];
      const isImageGen = tags.includes("image-generation");
      const capabilities: Modality[] = [];

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

      const creator =
        m.owned_by ?? (m.id.slice(0, Math.max(0, m.id.indexOf("/"))) || "other");

      const pricing: ModelPricing | undefined =
        m.pricing?.input || m.pricing?.output || m.pricing?.image
          ? {
              ...(m.pricing.input ? { input: m.pricing.input } : {}),
              ...(m.pricing.output ? { output: m.pricing.output } : {}),
              ...(m.pricing.image ? { image: m.pricing.image } : {}),
            }
          : undefined;

      const entry: ModelEntry = {
        id: m.id,
        name: m.name,
        description: m.description,
        creator,
        capabilities,
        pricing,
      };

      entryMap.set(m.id, entry);

      if (capabilities.includes("text")) result.text.push(entry);
      if (capabilities.includes("image")) result.image.push(entry);
      if (capabilities.includes("video")) result.video.push(entry);

      if (m.type === "language" && isImageGen) {
        result.languageImageModelIds.add(m.id);
      }
    }

    result.all = [...entryMap.values()];
  } catch {
    process.stderr.write("Warning: could not fetch models from AI Gateway\n");
  }

  return result;
}

export function resolveModels(
  modality: Modality,
  userModel?: string,
  knownModels?: ModelEntry[]
): string[] {
  if (!userModel) return [DEFAULTS[modality]];
  const models = userModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => expandModelId(m, knownModels));
  return models.length > 0 ? models : [DEFAULTS[modality]];
}

function expandModelId(input: string, knownModels?: ModelEntry[]): string {
  if (input.includes("/")) return input;
  if (!knownModels) return input;

  for (const m of knownModels) {
    const name = m.id.slice(m.id.indexOf("/") + 1);
    if (name === input) return m.id;
  }

  return input;
}
