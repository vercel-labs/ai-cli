import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { gateway, type ImageModel, type LanguageModel } from "ai";

export interface CustomEndpoint {
  baseURL: string;
  apiKey?: string;
}

/**
 * Read an OpenAI-compatible custom endpoint from the environment.
 *
 * Setting `OPENAI_BASE_URL` opts text and image generation out of the Vercel
 * AI Gateway and routes them to the given endpoint instead (using
 * `OPENAI_API_KEY` for auth). Video has no OpenAI-compatible standard and
 * always stays on the gateway.
 */
export function getCustomEndpoint(): CustomEndpoint | null {
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  if (!baseURL) return null;
  return { baseURL, apiKey: process.env.OPENAI_API_KEY };
}

function createCompat(endpoint: CustomEndpoint) {
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: endpoint.baseURL,
    apiKey: endpoint.apiKey,
  });
}

export function languageModel(modelId: string): LanguageModel {
  const endpoint = getCustomEndpoint();
  return endpoint
    ? createCompat(endpoint).chatModel(modelId)
    : gateway(modelId);
}

export function imageModel(modelId: string): ImageModel {
  const endpoint = getCustomEndpoint();
  return endpoint
    ? createCompat(endpoint).imageModel(modelId)
    : gateway.image(modelId);
}
