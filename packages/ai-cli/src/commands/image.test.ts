import { describe, expect, test } from "bun:test";

import {
  extractSvgImage,
  generatedImageMediaType,
  languageImageProviderOptions,
} from "./image.js";

describe("SVG image models", () => {
  test("extracts SVG markup from a language-model response", () => {
    expect(extractSvgImage('<svg viewBox="0 0 10 10"><path /></svg>')).toBe(
      '<svg viewBox="0 0 10 10"><path /></svg>'
    );
    expect(
      extractSvgImage(
        'Here is the logo:\n```svg\n<svg viewBox="0 0 10 10">\n  <path />\n</svg>\n```'
      )
    ).toBe('<svg viewBox="0 0 10 10">\n  <path />\n</svg>');
  });

  test("rejects text without a complete SVG document", () => {
    expect(extractSvgImage("Here is your logo.")).toBeUndefined();
    expect(extractSvgImage("<svg><path />")).toBeUndefined();
  });

  test("uses the SVG media type for every Arrow image model", () => {
    for (const modelId of [
      "quiverai/arrow-1.1",
      "quiverai/arrow-2",
      "quiverai/arrow-2-telos",
    ]) {
      expect(generatedImageMediaType(modelId, "image/png")).toBe(
        "image/svg+xml"
      );
    }
    expect(generatedImageMediaType("openai/gpt-image-2", "image/png")).toBe(
      "image/png"
    );
  });
});

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
