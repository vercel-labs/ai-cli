import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  collectImageReference,
  isLikelyImage,
  loadImageReferences,
} from "./image-references.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("collectImageReference", () => {
  test("collects repeated values", () => {
    expect(collectImageReference("a.png")).toEqual(["a.png"]);
    expect(collectImageReference("b.png", ["a.png"])).toEqual([
      "a.png",
      "b.png",
    ]);
  });
});

describe("loadImageReferences", () => {
  test("loads local image files", async () => {
    const file = await makeTempFile([1, 2, 3]);
    const [image] = await loadImageReferences([file]);

    expect(Array.from(image as Uint8Array)).toEqual([1, 2, 3]);
  });

  test("loads file URLs", async () => {
    const file = await makeTempFile([4, 5, 6]);
    const [image] = await loadImageReferences([pathToFileURL(file).href]);

    expect(Array.from(image as Uint8Array)).toEqual([4, 5, 6]);
  });

  test("passes remote and data URLs through to the SDK", async () => {
    await expect(
      loadImageReferences([
        "HTTPS://EXAMPLE.COM/ref.png",
        "data:image/png;base64,AAAA",
      ])
    ).resolves.toEqual([
      "https://example.com/ref.png",
      "data:image/png;base64,AAAA",
    ]);
  });

  test("rejects unsupported URL schemes", async () => {
    await expect(
      loadImageReferences(["ftp://example.com/ref.png"])
    ).rejects.toThrow("unsupported reference image URL scheme");
  });

  test("rejects empty references", async () => {
    await expect(loadImageReferences(["  "])).rejects.toThrow(
      "--image cannot be empty"
    );
  });
});

describe("isLikelyImage", () => {
  test("detects common binary image formats", () => {
    expect(isLikelyImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]))).toBe(
      false
    );
    expect(
      isLikelyImage(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      )
    ).toBe(true);
    expect(isLikelyImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isLikelyImage(new TextEncoder().encode("GIF89a"))).toBe(true);
    expect(isLikelyImage(new TextEncoder().encode("RIFFxxxxWEBP"))).toBe(true);
  });

  test("detects iso image brands and svg text", () => {
    expect(isLikelyImage(new TextEncoder().encode("....ftypavif"))).toBe(true);
    expect(isLikelyImage(new TextEncoder().encode("  <svg></svg>"))).toBe(true);
  });

  test("does not treat ordinary text as an image", () => {
    expect(isLikelyImage(new TextEncoder().encode("summarize this"))).toBe(
      false
    );
  });
});

async function makeTempFile(bytes: number[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ai-cli-image-reference-"));
  tempDirs.push(dir);
  const file = join(dir, "ref.png");
  await writeFile(file, new Uint8Array(bytes));
  return file;
}
