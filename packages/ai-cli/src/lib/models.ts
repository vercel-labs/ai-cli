export type Modality = "text" | "image" | "video" | "speech" | "transcription";

const DEFAULTS: Record<Modality, string> = {
  text: process.env.AI_CLI_TEXT_MODEL ?? "openai/gpt-5.5",
  image: process.env.AI_CLI_IMAGE_MODEL ?? "openai/gpt-image-2",
  video: process.env.AI_CLI_VIDEO_MODEL ?? "bytedance/seedance-2.0",
  speech: process.env.AI_CLI_SPEECH_MODEL ?? "openai/tts-1",
  transcription: process.env.AI_CLI_TRANSCRIPTION_MODEL ?? "openai/whisper-1",
};

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const GATEWAY_TIMEOUT_MS = 5_000;

export interface ModelEndpoint {
  provider_name?: string;
  context_length?: number;
  max_completion_tokens?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    web_search?: string;
    [key: string]: unknown;
  };
  tags?: string[];
  uptime_last_1d?: number;
  latency_last_1h?: { p50?: number; p95?: number };
  throughput_last_1h?: { p50?: number; p95?: number };
}

export interface ModelEndpointsInfo {
  id: string;
  name?: string;
  description?: string;
  released?: number;
  endpoints: ModelEndpoint[];
}

export interface ModelPricing {
  input?: string;
  output?: string;
  image?: string;
  [key: string]: unknown;
}

export interface ModelEntry {
  id: string;
  name?: string;
  description?: string;
  creator: string;
  capabilities: Modality[];
  pricing?: ModelPricing;
  contextWindow?: number;
  maxTokens?: number;
  released?: number;
  tags?: string[];
}

export interface GatewayModels {
  text: ModelEntry[];
  image: ModelEntry[];
  video: ModelEntry[];
  speech: ModelEntry[];
  transcription: ModelEntry[];
  /** Models with a modality the CLI can generate with. */
  all: ModelEntry[];
  /** Every gateway model, including types the CLI cannot generate with
   * (embedding, realtime, reranking, ...). */
  lookup: ModelEntry[];
  languageImageModelIds: Set<string>;
}

interface RawGatewayModel {
  id: string;
  name?: string;
  description?: string;
  owned_by?: string;
  type?: string;
  tags?: string[];
  context_window?: number;
  max_tokens?: number;
  released?: number;
  pricing?: {
    [key: string]: unknown;
  };
}

let cached: Promise<GatewayModels> | null = null;

export function fetchGatewayModels(): Promise<GatewayModels> {
  if (!cached) {
    cached = doFetch().catch((err) => {
      cached = null;
      throw err;
    });
  }
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
    speech: [],
    transcription: [],
    all: [],
    lookup: [],
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
        case "speech":
          capabilities.push("speech");
          break;
        case "transcription":
          capabilities.push("transcription");
          break;
        default:
          break;
      }

      const creator =
        m.owned_by ??
        (m.id.slice(0, Math.max(0, m.id.indexOf("/"))) || "other");

      const pricing = normalizePricing(m.pricing);

      const entry: ModelEntry = {
        id: m.id,
        name: m.name,
        description: m.description,
        creator,
        capabilities,
        pricing,
        contextWindow: m.context_window,
        maxTokens: m.max_tokens,
        released: m.released,
        tags: tags.length > 0 ? tags : undefined,
      };

      entryMap.set(m.id, entry);

      if (capabilities.includes("text")) result.text.push(entry);
      if (capabilities.includes("image")) result.image.push(entry);
      if (capabilities.includes("video")) result.video.push(entry);
      if (capabilities.includes("speech")) result.speech.push(entry);
      if (capabilities.includes("transcription"))
        result.transcription.push(entry);

      if (m.type === "language" && isImageGen) {
        result.languageImageModelIds.add(m.id);
      }
    }

    result.lookup = [...entryMap.values()];
    result.all = result.lookup.filter((e) => e.capabilities.length > 0);
  } catch {
    cached = null;
    process.stderr.write("Warning: could not fetch models from AI Gateway\n");
  }

  return result;
}

export async function fetchModelEndpoints(
  modelId: string
): Promise<ModelEndpointsInfo | null> {
  try {
    const res = await fetch(`${GATEWAY_MODELS_URL}/${modelId}/endpoints`, {
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: ModelEndpointsInfo };
    if (!json.data) return null;
    return { ...json.data, endpoints: json.data.endpoints ?? [] };
  } catch {
    process.stderr.write(
      "Warning: could not fetch provider endpoints from AI Gateway\n"
    );
    return null;
  }
}

function normalizePricing(
  pricing?: Record<string, unknown>
): ModelPricing | undefined {
  if (!pricing) return undefined;

  const entries = Object.entries(pricing).filter(
    ([, value]) => value != null && value !== ""
  );
  if (entries.length === 0) return undefined;

  return Object.fromEntries(entries) as ModelPricing;
}

export function resolveModels(
  modality: Modality,
  userModel?: string,
  knownModels?: Pick<ModelEntry, "id">[]
): string[] {
  if (!userModel) return [DEFAULTS[modality]];
  const models = userModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => expandModelId(m, knownModels));
  return models.length > 0 ? models : [DEFAULTS[modality]];
}

export function expandModelId(
  input: string,
  knownModels?: Pick<ModelEntry, "id">[]
): string {
  if (input.includes("/")) return input;
  if (!knownModels) return input;

  for (const m of knownModels) {
    const name = m.id.slice(m.id.indexOf("/") + 1);
    if (name === input) return m.id;
  }

  return input;
}
