import { describe, expect, mock, test } from "bun:test";

import {
  resolveModels,
  fetchGatewayModels,
  FALLBACK_TEXT_MODELS,
  FALLBACK_IMAGE_MODELS,
  FALLBACK_VIDEO_MODELS,
} from "./models.js";

describe("resolveModels", () => {
  test("returns default when no user model", () => {
    expect(resolveModels("text")[0]).toContain("/");
    expect(resolveModels("image")[0]).toContain("/");
    expect(resolveModels("video")[0]).toContain("/");
  });

  test("returns fully-qualified model as-is", () => {
    expect(resolveModels("text", "openai/gpt-4")).toEqual(["openai/gpt-4"]);
    expect(resolveModels("image", "openai/gpt-image-1")).toEqual([
      "openai/gpt-image-1",
    ]);
  });

  test("expands short image model names", () => {
    expect(resolveModels("image", "gpt-image-1")).toEqual([
      "openai/gpt-image-1",
    ]);
    expect(resolveModels("image", "flux-2-pro")).toEqual(["bfl/flux-2-pro"]);
  });

  test("expands short video model names", () => {
    expect(resolveModels("video", "seedance-2.0")).toEqual([
      "bytedance/seedance-2.0",
    ]);
  });

  test("expands short text model names", () => {
    expect(resolveModels("text", "gpt-5.5")).toEqual(["openai/gpt-5.5"]);
    expect(resolveModels("text", "o3")).toEqual(["openai/o3"]);
  });

  test("returns unknown short names as-is for text", () => {
    expect(resolveModels("text", "gpt-image-1")).toEqual(["gpt-image-1"]);
    expect(resolveModels("text", "my-model")).toEqual(["my-model"]);
  });

  test("returns unknown short names as-is for image/video", () => {
    expect(resolveModels("image", "nonexistent-model")).toEqual([
      "nonexistent-model",
    ]);
  });
});

describe("resolveModels multi", () => {
  test("returns default when no user model", () => {
    const result = resolveModels("text");
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/");
  });

  test("splits comma-separated models", () => {
    const result = resolveModels("image", "openai/gpt-image-1,bfl/flux-2-pro");
    expect(result).toEqual(["openai/gpt-image-1", "bfl/flux-2-pro"]);
  });

  test("trims whitespace around model names", () => {
    const result = resolveModels(
      "image",
      "openai/gpt-image-1 , bfl/flux-2-pro"
    );
    expect(result).toEqual(["openai/gpt-image-1", "bfl/flux-2-pro"]);
  });

  test("expands short names in comma list", () => {
    const result = resolveModels("image", "gpt-image-1,flux-2-pro");
    expect(result).toEqual(["openai/gpt-image-1", "bfl/flux-2-pro"]);
  });

  test("filters empty segments from trailing comma", () => {
    const result = resolveModels("image", "openai/gpt-image-1,");
    expect(result).toEqual(["openai/gpt-image-1"]);
  });

  test("falls back to default when all segments are empty", () => {
    const result = resolveModels("image", ",,,");
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/");
  });
});

describe("fetchGatewayModels", () => {
  test("partitions models by modelType", async () => {
    const { gateway } = await import("ai");
    const original = gateway.getAvailableModels;
    gateway.getAvailableModels = mock(() =>
      Promise.resolve({
        models: [
          { id: "openai/gpt-5", name: "GPT 5", modelType: "language" },
          {
            id: "openai/gpt-image-2",
            name: "GPT Image 2",
            description: "Image gen",
            modelType: "image",
          },
          { id: "google/veo-3.0", name: "Veo 3", modelType: "video" },
          {
            id: "openai/text-embedding-3",
            name: "Embedding",
            modelType: "embedding",
          },
        ],
      })
    ) as unknown as typeof gateway.getAvailableModels;

    try {
      const result = await fetchGatewayModels();

      expect(result.text).toEqual([
        { id: "openai/gpt-5", name: "GPT 5", description: undefined },
      ]);
      expect(result.image).toEqual([
        {
          id: "openai/gpt-image-2",
          name: "GPT Image 2",
          description: "Image gen",
        },
      ]);
      expect(result.video).toEqual([
        { id: "google/veo-3.0", name: "Veo 3", description: undefined },
      ]);
    } finally {
      gateway.getAvailableModels = original;
    }
  });

  test("falls back to static lists on gateway error", async () => {
    const { gateway } = await import("ai");
    const original = gateway.getAvailableModels;
    gateway.getAvailableModels = mock(() =>
      Promise.reject(new Error("network error"))
    ) as typeof gateway.getAvailableModels;

    try {
      const result = await fetchGatewayModels();

      expect(result.text.map((m) => m.id)).toEqual(FALLBACK_TEXT_MODELS);
      expect(result.image.map((m) => m.id)).toEqual(FALLBACK_IMAGE_MODELS);
      expect(result.video.map((m) => m.id)).toEqual(FALLBACK_VIDEO_MODELS);
    } finally {
      gateway.getAvailableModels = original;
    }
  });

  test("uses fallbacks when gateway returns no image/video models", async () => {
    const { gateway } = await import("ai");
    const original = gateway.getAvailableModels;
    gateway.getAvailableModels = mock(() =>
      Promise.resolve({
        models: [{ id: "openai/gpt-5", name: "GPT 5", modelType: "language" }],
      })
    ) as unknown as typeof gateway.getAvailableModels;

    try {
      const result = await fetchGatewayModels();

      expect(result.text).toHaveLength(1);
      expect(result.text[0].id).toBe("openai/gpt-5");
      expect(result.image.map((m) => m.id)).toEqual(FALLBACK_IMAGE_MODELS);
      expect(result.video.map((m) => m.id)).toEqual(FALLBACK_VIDEO_MODELS);
    } finally {
      gateway.getAvailableModels = original;
    }
  });

  test("uses text fallbacks when gateway returns no text models", async () => {
    const { gateway } = await import("ai");
    const original = gateway.getAvailableModels;
    gateway.getAvailableModels = mock(() =>
      Promise.resolve({
        models: [
          { id: "openai/gpt-image-2", name: "GPT Image 2", modelType: "image" },
        ],
      })
    ) as unknown as typeof gateway.getAvailableModels;

    try {
      const result = await fetchGatewayModels();

      expect(result.text.map((m) => m.id)).toEqual(FALLBACK_TEXT_MODELS);
      expect(result.image).toHaveLength(1);
      expect(result.video.map((m) => m.id)).toEqual(FALLBACK_VIDEO_MODELS);
    } finally {
      gateway.getAvailableModels = original;
    }
  });
});
