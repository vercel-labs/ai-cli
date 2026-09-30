import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { videoGenerationOptions } from "./video.js";

const directory = mkdtempSync(join(tmpdir(), "ai-cli-video-"));
const preload = join(directory, "gateway.js");
const startUrl = "https://example.com/start.png";
const endUrl = "https://example.com/end.png";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64"
);
const imagePath = join(directory, "frame.png");
writeFileSync(imagePath, png);
writeFileSync(
  preload,
  `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  appendFileSync(process.env.TEST_REQUESTS, JSON.stringify({ url: String(url), body }) + '\\n');
  if (String(url).endsWith('/models')) return Response.json({ data: [] });
  if (!String(url).endsWith('/video-model')) throw new Error('Unexpected network request');
  const result = { type: 'result', videos: [{ type: 'base64', data: 'dmlkZW8=', mediaType: 'video/mp4' }] };
  return new Response('data: ' + JSON.stringify(result) + '\\n\\n', { headers: { 'content-type': 'text/event-stream' } });
};
`
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function run(args: string[], input?: Uint8Array) {
  const requestPath = join(directory, `requests-${crypto.randomUUID()}.jsonl`);
  writeFileSync(requestPath, "");
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      "--preload",
      preload,
      "src/index.ts",
      "video",
      "--quiet",
      "--no-preview",
      "--model",
      "bytedance/seedance-2.0",
      ...args,
    ],
    {
      cwd: import.meta.dir + "/../..",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "test-key",
        TEST_REQUESTS: requestPath,
      },
    }
  );
  if (input) proc.stdin.write(input);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const requests = readFileSync(requestPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const generations = requests
    .filter(({ url }) => url.endsWith("/video-model"))
    .map(({ body }) => body);
  return { stdout, stderr, exitCode, requests, generations };
}

describe("video frame inputs", () => {
  test("sends start/end frame roles through the SDK to Gateway", async () => {
    const result = await run([
      "transition between these frames",
      "--start-frame",
      startUrl,
      "--end-frame",
      endUrl,
      "--duration",
      "3",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("video");
    expect(result.generations).toHaveLength(1);
    expect(result.generations[0]).toMatchObject({
      prompt: "transition between these frames",
      duration: 3,
      frameImages: [
        { frameType: "first_frame", image: { type: "url", url: startUrl } },
        { frameType: "last_frame", image: { type: "url", url: endUrl } },
      ],
    });
  });

  test("accepts --image with an end frame and no text prompt", async () => {
    const result = await run([
      "-i",
      imagePath,
      "--end-frame",
      pathToFileURL(imagePath).href,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.generations[0].frameImages).toEqual(
      ["first_frame", "last_frame"].map((frameType) => ({
        frameType,
        image: {
          type: "file",
          mediaType: "image/png",
          data: png.toString("base64"),
        },
      }))
    );
  });

  test("accepts piped start bytes with a data URL end frame", async () => {
    const result = await run(
      ["--end-frame", `data:image/png;base64,${png.toString("base64")}`],
      png
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.generations[0].frameImages).toEqual(
      ["first_frame", "last_frame"].map((frameType) => ({
        frameType,
        image: {
          type: "file",
          mediaType: "image/png",
          data: png.toString("base64"),
        },
      }))
    );
  });

  test.each(["--image", "--start-frame"])(
    "%s alone preserves single-image generation",
    async (flag) => {
      const result = await run([flag, startUrl]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.generations[0].image).toEqual({
        type: "url",
        url: startUrl,
      });
      expect(result.generations[0]).not.toHaveProperty("frameImages");
    }
  );

  test("preserves text-only and stdin-only generation", async () => {
    const text = await run(["a spinning triangle"]);
    expect(text.exitCode).toBe(0);
    expect(text.generations[0].prompt).toBe("a spinning triangle");
    expect(text.generations[0]).not.toHaveProperty("image");
    expect(text.generations[0]).not.toHaveProperty("frameImages");

    const stdin = await run([], png);
    expect(stdin.exitCode).toBe(0);
    expect(stdin.generations[0].image).toEqual({
      type: "file",
      mediaType: "image/png",
      data: png.toString("base64"),
    });
    expect(stdin.generations[0]).not.toHaveProperty("frameImages");
  });

  test.each([
    ["--image", startUrl, "--image", endUrl],
    ["--start-frame", startUrl, "--start-frame", endUrl],
    ["--image", startUrl, "--start-frame", endUrl],
  ])(
    "rejects ambiguous start frames before network calls: %j",
    async (firstFlag, firstUrl, secondFlag, secondUrl) => {
      const result = await run([firstFlag, firstUrl, secondFlag, secondUrl]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("one start frame");
      expect(result.stderr).toContain("--end-frame");
      expect(result.requests).toEqual([]);
    }
  );

  test.each(["--image", "--start-frame"])(
    "rejects %s combined with a piped start frame",
    async (flag) => {
      const result = await run([flag, startUrl, "--end-frame", endUrl], png);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("one start frame");
      expect(result.requests).toEqual([]);
    }
  );

  test("requires a start frame when an end frame is supplied", async () => {
    const result = await run(["transition", "--end-frame", endUrl]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--end-frame requires a start frame");
    expect(result.requests).toEqual([]);
  });

  test("rejects repeated end frames", async () => {
    const result = await run([
      "--start-frame",
      startUrl,
      "--end-frame",
      endUrl,
      "--end-frame",
      endUrl,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("one end frame");
    expect(result.requests).toEqual([]);
  });

  test.each(["--start-frame", "--end-frame"])(
    "validates %s files and empty values before network calls",
    async (flag) => {
      for (const value of ["/missing/frame.png", " "]) {
        const result = await run([
          ...(flag === "--end-frame" ? ["--start-frame", startUrl] : []),
          flag,
          value,
        ]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          value.trim()
            ? "could not read reference image"
            : `${flag} cannot be empty`
        );
        expect(result.requests).toEqual([]);
      }
    }
  );
});

describe("videoGenerationOptions", () => {
  test("forwards parsed video generation options", () => {
    expect(
      videoGenerationOptions({
        aspectRatio: "16:9",
        resolution: "1920x1080",
        duration: "5",
      })
    ).toEqual({
      aspectRatio: "16:9",
      resolution: "1920x1080",
      duration: 5,
    });
  });

  test("rejects invalid resolutions with the video flag name", () => {
    expect(() => videoGenerationOptions({ resolution: "1080p" })).toThrow(
      "--resolution must be in WxH format"
    );
  });
});
