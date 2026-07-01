import { describe, expect, test } from "bun:test";

import { buildLanguageImageProviderOptions } from "./image.js";

describe("buildLanguageImageProviderOptions", () => {
  test("returns undefined for non-google creators", () => {
    expect(buildLanguageImageProviderOptions("openai", "16:9")).toBeUndefined();
    expect(
      buildLanguageImageProviderOptions(undefined, "16:9")
    ).toBeUndefined();
  });

  test("sets image and text response modalities for google", () => {
    expect(buildLanguageImageProviderOptions("google", undefined)).toEqual({
      google: { responseModalities: ["IMAGE", "TEXT"] },
    });
  });

  test("forwards aspect ratio via imageConfig when provided", () => {
    expect(buildLanguageImageProviderOptions("google", "16:9")).toEqual({
      google: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });
  });
});
