import { jsonSchema, type generateText, type ToolSet } from "ai";

import type { MediaArtifact } from "./media-jobs.js";
import { isObject, readJsonObject } from "./media-options.js";

type TextOptions = Pick<
  Parameters<typeof generateText>[0],
  | "system"
  | "maxOutputTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "presencePenalty"
  | "frequencyPenalty"
  | "stopSequences"
  | "reasoning"
  | "tools"
  | "toolChoice"
  | "activeTools"
>;
const TEXT_KEYS = new Set([
  "system",
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "stopSequences",
  "reasoning",
  "tools",
  "toolChoice",
  "activeTools",
]);

export async function readGenerateTextOptions(
  path: string
): Promise<TextOptions> {
  const value = await readJsonObject(path, "generate-text-options");
  for (const key of Object.keys(value)) {
    if (!TEXT_KEYS.has(key))
      throw new Error(
        `Unsupported --generate-text-options key: ${key}; use the corresponding CLI option for request and provider settings`
      );
  }
  if (value.tools !== undefined) {
    if (!isObject(value.tools))
      throw new Error("generateText tools must be an object");
    const tools: ToolSet = {};
    for (const [name, tool] of Object.entries(value.tools)) {
      if (
        !isObject(tool) ||
        tool.type !== "provider" ||
        typeof tool.id !== "string" ||
        !/^[^.]+\..+$/.test(tool.id) ||
        !isObject(tool.args)
      ) {
        throw new Error(
          `Tool ${name} must have SDK shape { type: "provider", id: "provider.tool", args: {} }`
        );
      }
      if (tool.isProviderExecuted === false)
        throw new Error(
          `Tool ${name} requires local execution, which image generation does not support`
        );
      Object.defineProperty(tools, name, {
        enumerable: true,
        value: {
          type: "provider",
          id: tool.id as `${string}.${string}`,
          args: tool.args,
          isProviderExecuted: true,
          inputSchema: jsonSchema({}),
          outputSchema: jsonSchema({}),
        },
      });
    }
    value.tools = tools;
  }
  return value as TextOptions;
}

export function toolImages(
  results: Array<{ toolName: string; output: unknown }>,
  tools: ToolSet | undefined,
  id?: string
): MediaArtifact[] {
  return results.flatMap(({ toolName, output }) => {
    const tool = tools?.[toolName];
    if (
      tool?.id !== "openai.image_generation" ||
      !isObject(output) ||
      typeof output.result !== "string"
    )
      return [];
    const format =
      output.outputFormat ??
      output.output_format ??
      tool.args.outputFormat ??
      "png";
    if (!["png", "jpeg", "webp"].includes(String(format)))
      throw new Error(
        `Unsupported image_generation output format: ${String(format)}`
      );
    return [
      {
        data: Buffer.from(output.result, "base64"),
        mediaType: `image/${String(format)}`,
        id,
      },
    ];
  });
}
