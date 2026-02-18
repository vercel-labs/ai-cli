import { AI_CLI_HEADERS } from './constants.js';
import { GATEWAY_URL } from './models.js';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

export interface EmbeddingResult {
  embedding: number[];
  index: number;
}

/**
 * Embed one or more text chunks via the AI Gateway.
 * Uses the OpenAI-compatible /v1/embeddings endpoint.
 */
export async function embed(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const res = await fetch(`${GATEWAY_URL}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...AI_CLI_HEADERS,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(
      `embedding request failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    data: EmbeddingResult[];
  };

  if (!json?.data || !Array.isArray(json.data)) {
    throw new Error('unexpected embedding response format');
  }

  // Sort by index to match input order
  const sorted = json.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
