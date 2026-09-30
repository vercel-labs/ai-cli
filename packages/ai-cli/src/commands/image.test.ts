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

  test("extracts the complete document when SVG elements are nested", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><svg x="1" y="1"><path /></svg><rect /></svg>';

    expect(extractSvgImage(`Here is the image:\n${svg}\nDone.`)).toBe(svg);
  });

  test("skips an unmatched SVG mention before a complete document", () => {
    const svg = '<svg viewBox="0 0 10 10"><path /></svg>';
    const response = `Use an \`<svg>\` element for this image.\n\`\`\`svg\n${svg}\n\`\`\``;

    expect(extractSvgImage(response)).toBe(svg);
  });

  test("skips a balanced SVG mention before a complete document", () => {
    const svg = '<svg viewBox="0 0 10 10"><path /></svg>';
    const response = `Wrap the output in \`<svg></svg>\` tags.\n\`\`\`svg\n${svg}\n\`\`\``;

    expect(extractSvgImage(response)).toBe(svg);
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

// Exercise the real CLI, SDK and Gateway adapter together without paid calls.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mediaFixture, pngBase64 } from "../test/media.js";

const fixture = mediaFixture();
const generate = (args: string[], mode?: string) =>
  fixture.run(
    ["image", "--quiet", "--no-preview", "--max-retries", "0", ...args],
    { mode }
  );

describe("SDK image generation", () => {
  test("forwards masks, seed zero, nested provider options, headers, and native batching", async () => {
    const options = {
      openai: {
        quality: "high",
        outputFormat: "webp",
        background: "transparent",
        inputFidelity: "high",
      },
      gateway: { order: ["openai"], models: ["openai/gpt-image-2"] },
    };
    const result = await generate(
      [
        "edit",
        "--images",
        fixture.image,
        "--mask",
        fixture.image,
        "--seed",
        "0",
        "--n",
        "3",
        "--max-images-per-call",
        "2",
        "--provider-options",
        fixture.json(options),
        "--headers",
        fixture.json({
          "x-custom": "yes",
          "HTTP-REFERER": "https://custom.example",
        }),
        "--base-url",
        "https://custom.example/v4/ai",
        "--team-id-or-slug",
        "my-team",
        "--json",
        "--output",
        join(fixture.directory, "batch/"),
      ],
      "warnings"
    );
    expect(result.exitCode).toBe(0);
    const requests = result.requests.filter((item) =>
      item.route.endsWith("/image-model")
    );
    expect(requests.map((item) => item.body.n)).toEqual([2, 1]);
    expect(requests[0].body).toMatchObject({
      seed: 0,
      providerOptions: options,
      files: [{ type: "file", data: pngBase64 }],
      mask: { type: "file", data: pngBase64 },
    });
    expect(requests[0].url).toBe("https://custom.example/v4/ai/image-model");
    expect(requests[0].headers["x-custom"]).toBe("yes");
    expect(requests[0].headers["http-referer"]).toBe("https://custom.example");
    expect(requests[0].headers["x-vercel-ai-gateway-team"]).toBe("my-team");
    const manifest = JSON.parse(result.stdout).results[0];
    expect(manifest.images).toHaveLength(3);
    expect(manifest.calls).toHaveLength(2);
    expect(manifest.calls[0].images).toEqual(manifest.images.slice(0, 2));
    expect(manifest.calls[1].images).toEqual(manifest.images.slice(2));
    expect(manifest.calls[0].providerMetadata.gateway.cost).toBe("0.123");
    expect(
      manifest.calls[0].providerMetadata.openai.images[0].revisedPrompt
    ).toBe("revised");
    expect(manifest.usage.totalTokens).toBe(92);
    expect(manifest.warnings[0].feature).toBe("style");
  });

  test("merges Gemini imageConfig and preserves all image files and text", async () => {
    const result = await generate([
      "scene",
      "-m",
      "google/gemini-3-pro-image",
      "--aspect-ratio",
      "16:9",
      "--provider-options",
      fixture.json({ google: { imageConfig: { imageSize: "4K" } } }),
      "--json",
      "-o",
      join(fixture.directory, "gemini/"),
    ]);
    expect(result.exitCode).toBe(0);
    const request = result.requests.find((item) =>
      item.route.endsWith("/language-model")
    );
    expect(request.body.providerOptions.google).toEqual({
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
    });
    const output = JSON.parse(result.stdout).results[0];
    expect(output.images).toHaveLength(2);
    expect(output.text).toBe("Two generated images");
    expect(output.response.id).toBeString();
    expect(output.images[0].id).toBe(output.response.id);
  });

  test("extracts OpenAI provider-tool image output using its configured format", async () => {
    const result = await generate(
      [
        "scene",
        "-m",
        "openai/gpt-5.5",
        "--generate-text-options",
        fixture.json({
          maxOutputTokens: 1000,
          tools: {
            image_generation: {
              type: "provider",
              id: "openai.image_generation",
              args: { outputFormat: "webp", quality: "high" },
            },
          },
        }),
        "--json",
        "-o",
        join(fixture.directory, "tool/"),
      ],
      "tool"
    );
    expect(result.exitCode).toBe(0);
    const request = result.requests.find((item) =>
      item.route.endsWith("/language-model")
    );
    expect(request.body.maxOutputTokens).toBe(1000);
    expect(request.body.tools[0]).toMatchObject({
      type: "provider",
      id: "openai.image_generation",
      args: { outputFormat: "webp", quality: "high" },
    });
    const output = JSON.parse(result.stdout).results[0];
    expect(output.images[0].mediaType).toBe("image/webp");
    expect(output.images[0].file.endsWith(".webp")).toBe(true);
    expect(readFileSync(output.images[0].file).toString("base64")).toBe(
      pngBase64
    );
    expect(result.stdout).not.toContain(pngBase64);
  });

  test("discovery failure never silently changes the generation API", async () => {
    const args = [
      "scene",
      "-m",
      "google/gemini-3-pro-image",
      "--json",
      "-o",
      join(fixture.directory, "explicit/"),
    ];
    for (const mode of ["catalog-failure", "catalog-malformed"]) {
      const failed = await generate(args, mode);
      expect(failed.exitCode).toBe(1);
      expect(failed.requests).toHaveLength(1);
      expect(JSON.parse(failed.stdout).error.message).toContain("--api");
      const explicit = await generate([...args, "--api", "generateText"], mode);
      expect(explicit.exitCode).toBe(0);
      expect(
        explicit.requests.some((item) => item.route.endsWith("/language-model"))
      ).toBe(true);
    }
  });

  test("returns structured single and partial errors even with quiet", async () => {
    const single = await generate(["scene", "--json"], "failure");
    expect(single.exitCode).toBe(1);
    expect(JSON.parse(single.stdout).results[0].error.message).toContain(
      "Unsupported requested setting"
    );
    expect(single.stderr).toContain("Unsupported requested setting");
    const partial = await generate(
      [
        "scene",
        "-m",
        "test/fail,openai/gpt-image-2",
        "--json",
        "-o",
        join(fixture.directory, "partial/"),
      ],
      "partial"
    );
    expect(partial.exitCode).toBe(2);
    expect(
      JSON.parse(partial.stdout).results.map(
        (item: { success: boolean }) => item.success
      )
    ).toEqual([false, true]);
    expect(partial.stderr).toContain("Unsupported requested setting");
  });

  test.each(["--quality", "--style", "--count", "--image"])(
    "rejects removed flag %s",
    async (flag) => {
      const result = await generate(["scene", flag, "1", "--json"]);
      expect(result.exitCode).toBe(1);
      expect(result.requests).toHaveLength(0);
    }
  );

  test("rejects invalid dimensions and nested option shape before network", async () => {
    for (const args of [
      ["--size", "0x0"],
      ["--aspect-ratio", "0:0"],
      ["--n", "9007199254740992"],
      ["--provider-options", fixture.json({ openai: "wrong" })],
      ["--headers", fixture.json({ invalid: 1 })],
    ]) {
      const result = await generate(["scene", ...args, "--json"]);
      expect(result.exitCode).toBe(1);
      expect(result.requests).toHaveLength(0);
      expect(JSON.parse(result.stdout).success).toBe(false);
    }
  });

  test("models list and detail preserve native capability metadata", async () => {
    for (const args of [
      ["models", "--type", "video", "--json"],
      ["models", "bytedance/seedance-2.0", "--json"],
    ]) {
      const result = await fixture.run(args);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const model = Array.isArray(json) ? json[0] : json;
      expect(model.video_capabilities).toEqual({ durations: [4, 15] });
      expect(model.supported_specifications).toEqual(["video-v4"]);
      expect(model.modalities.output).toEqual(["video"]);
    }
  });
});
