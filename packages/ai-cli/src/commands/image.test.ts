import { describe, expect, test } from "bun:test";

import { languageImageProviderOptions } from "./image.js";

describe("languageImageProviderOptions", () => {
  test("returns undefined for non-google creators", () => {
    expect(languageImageProviderOptions("openai")).toBeUndefined();
    expect(languageImageProviderOptions("openai", "16:9")).toBeUndefined();
    expect(languageImageProviderOptions(undefined, "16:9")).toBeUndefined();
  });

  test("requests image output for google models", () => {
    expect(languageImageProviderOptions("google")).toEqual({
      google: { responseModalities: ["IMAGE", "TEXT"] },
    });
  });

  test("forwards aspect ratio via imageConfig for google models", () => {
    expect(languageImageProviderOptions("google", "16:9")).toEqual({
      google: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });
  });
});
