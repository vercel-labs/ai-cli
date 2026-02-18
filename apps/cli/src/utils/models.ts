import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway';
import { gateway } from '@ai-sdk/gateway';

export const GATEWAY_URL = 'https://ai-gateway.vercel.sh';

export type Model = GatewayLanguageModelEntry;

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
}

let cachedModels: Model[] | null = null;
let modelsCachedAt = 0;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const capabilitiesCache: Map<string, ModelCapabilities> = new Map();

export async function fetchModels(forceRefresh = false): Promise<Model[]> {
  if (
    !forceRefresh &&
    cachedModels &&
    Date.now() - modelsCachedAt < MODEL_CACHE_TTL_MS
  ) {
    return cachedModels;
  }
  const { models } = await gateway.getAvailableModels();
  cachedModels = models;
  modelsCachedAt = Date.now();
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

  throw new Error(`no model found for "${query}"`);
}

const REASONING_PATTERN = /\bo[134]\b|\bthinking\b|\breason/;

export async function getModelCapabilities(
  modelId: string,
): Promise<ModelCapabilities> {
  const cached = capabilitiesCache.get(modelId);
  if (cached) {
    return cached;
  }

  const lower = modelId.toLowerCase();

  const capabilities: ModelCapabilities = {
    vision: true,
    tools: true,
    reasoning: REASONING_PATTERN.test(lower),
  };

  capabilitiesCache.set(modelId, capabilities);
  return capabilities;
}
