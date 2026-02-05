export const GATEWAY_URL = 'https://ai-gateway.vercel.sh';

export interface Model {
  id: string;
  type: string;
  owned_by: string;
  tags?: string[];
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
}

let cachedModels: Model[] | null = null;
const capabilitiesCache: Map<string, ModelCapabilities> = new Map();

export async function fetchModels(): Promise<Model[]> {
  if (cachedModels) return cachedModels;
  const response = await fetch(`${GATEWAY_URL}/v1/models`);
  const { data } = (await response.json()) as { data: Model[] };
  cachedModels = data.filter((m) => m.type === 'language');
  return cachedModels;
}

export function scoreMatch(id: string, query: string): number {
  const lower = id.toLowerCase();
  const q = query.toLowerCase();
  const normalizedId = lower.replace(/[-_.]/g, '');
  const normalizedQ = q.replace(/[-_.]/g, '');

  if (lower === q) return 1000;
  if (normalizedId.endsWith(`/${normalizedQ}`)) return 950;
  if (normalizedId.includes(normalizedQ)) return 900;
  if (lower.endsWith(`/${q}`)) return 850;
  if (lower.includes(`/${q}`)) return 800;

  const parts = q.split(/[-/]/);
  let score = 0;
  for (const part of parts) {
    if (part && lower.includes(part)) score += 100;
  }

  const idx = lower.indexOf(q);
  if (idx !== -1) {
    score += 200 - idx;
  }

  if (score > 0) score += Math.max(0, 50 - id.length);

  return score;
}

export async function resolveModel(query: string): Promise<string> {
  const models = await fetchModels();

  const exact = models.find((m) => m.id.toLowerCase() === query.toLowerCase());
  if (exact) return exact.id;

  const scored = models
    .map((m) => ({ model: m, score: scoreMatch(m.id, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored[0].model.id;
  }

  console.error(`no model found for "${query}"`);
  process.exit(1);
}

export async function getModelCapabilities(modelId: string): Promise<ModelCapabilities> {
  if (capabilitiesCache.has(modelId)) {
    return capabilitiesCache.get(modelId)!;
  }

  const models = await fetchModels();
  const model = models.find((m) => m.id === modelId);
  const tags = model?.tags || [];

  const capabilities: ModelCapabilities = {
    vision: tags.includes('vision'),
    tools: tags.includes('tool-use'),
    reasoning: tags.includes('reasoning'),
  };

  capabilitiesCache.set(modelId, capabilities);
  return capabilities;
}

export function hasVision(capabilities: ModelCapabilities): boolean {
  return capabilities.vision;
}

export function hasTools(capabilities: ModelCapabilities): boolean {
  return capabilities.tools;
}
