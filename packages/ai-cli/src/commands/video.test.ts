import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { mediaFixture, png, pngBase64 } from "../test/media.js";
import { videoGenerationOptions } from "./video.js";

const fixture = mediaFixture();
const start = "https://example.com/start.png";
const end = "https://example.com/end.png";
const generate = (args: string[], mode?: string, input?: Uint8Array) =>
  fixture.run(
    [
      "video",
      "--quiet",
      "--no-preview",
      "--poll-interval-ms",
      "1",
      "--max-retries",
      "0",
      ...args,
    ],
    { mode, input }
  );

describe("SDK video generation", () => {
  test("passes frame roles, adaptive ratio, seed zero, fps and audio through polling", async () => {
    const frames = fixture.json([
      { image: start, frameType: "first_frame" },
      { image: end, frameType: "last_frame" },
    ]);
    const result = await generate(
      [
        "transition",
        "--frame-images",
        frames,
        "--aspect-ratio",
        "adaptive",
        "--seed",
        "0",
        "--fps",
        "24",
        "--no-generate-audio",
        "--duration",
        "5",
      ],
      "poll"
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("video1");
    const request = result.requests.find((item) =>
      item.route.endsWith("/start")
    );
    expect(request.body).toMatchObject({
      seed: 0,
      fps: 24,
      generateAudio: false,
      duration: 5,
      aspectRatio: "adaptive",
      frameImages: [
        { frameType: "first_frame", image: { type: "url", url: start } },
        { frameType: "last_frame", image: { type: "url", url: end } },
      ],
    });
    expect(
      result.requests.filter((item) => item.route.endsWith("/status"))
    ).toHaveLength(2);
  });

  test("accepts last-frame-only local/file/data URL inputs", async () => {
    for (const image of [
      fixture.image,
      pathToFileURL(fixture.image).href,
      `data:image/png;base64,${pngBase64}`,
    ]) {
      const result = await generate([
        "--frame-images",
        fixture.json([{ image, frameType: "last_frame" }]),
      ]);
      expect(result.exitCode).toBe(0);
      expect(
        result.requests.find((item) => item.route.endsWith("/start")).body
          .frameImages
      ).toEqual([
        {
          frameType: "last_frame",
          image: { type: "file", mediaType: "image/png", data: pngBase64 },
        },
      ]);
    }
  });

  test("accepts piped and explicit prompt.image", async () => {
    const piped = await generate([], undefined, png);
    const explicit = await generate(["--image", fixture.image]);
    for (const result of [piped, explicit]) {
      expect(result.exitCode).toBe(0);
      expect(
        result.requests.find((item) => item.route.endsWith("/start")).body.image
          .data
      ).toBe(pngBase64);
    }
  });

  test("passes typed video and image inputReferences", async () => {
    const result = await generate([
      "--input-references",
      fixture.json([
        start,
        { data: "https://example.com/source.mp4", mediaType: "video/mp4" },
      ]),
      "--generate-audio",
    ]);
    expect(result.exitCode).toBe(0);
    expect(
      result.requests.find((item) => item.route.endsWith("/start")).body
    ).toMatchObject({
      generateAudio: true,
      inputReferences: [
        { type: "url", url: start },
        {
          type: "url",
          url: "https://example.com/source.mp4",
          mediaType: "video/mp4",
        },
      ],
    });
  });

  test("uses native n/batching and saves every video with its media type", async () => {
    const result = await generate([
      "a scene",
      "--n",
      "3",
      "--max-videos-per-call",
      "2",
      "--json",
      "-o",
      join(fixture.directory, "batch/"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(
      result.requests
        .filter((item) => item.route.endsWith("/start"))
        .map((item) => item.body.n)
    ).toEqual([2, 1]);
    const output = JSON.parse(result.stdout).results[0];
    expect(output.videos).toHaveLength(3);
    expect(output.providerMetadata.gateway.cost).toBe("0.42");
    expect(
      output.responses.map(
        (response: { headers: Record<string, string> }) =>
          response.headers["x-request-id"]
      )
    ).toEqual(["batch-2", "batch-1"]);
    expect(output.videos.map((video: { id?: string }) => video.id)).toEqual([
      "batch-2",
      "batch-2",
      "batch-1",
    ]);
    for (const video of output.videos)
      expect(video.file.endsWith(".webm")).toBe(true);
  });

  test("omits ambiguous video IDs when a batch returns fewer outputs", async () => {
    const result = await generate(
      [
        "a scene",
        "--n",
        "3",
        "--max-videos-per-call",
        "2",
        "--json",
        "-o",
        join(fixture.directory, "short-batch/"),
      ],
      "short-video-batch"
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout).results[0];
    expect(output.videos).toHaveLength(2);
    expect(output.videos.every((video: { id?: string }) => !video.id)).toBe(
      true
    );
    expect(output.responses).toHaveLength(2);
  });

  test("never concatenates multiple binary outputs without an output path", async () => {
    const before = new Set(readdirSync(fixture.directory));
    const result = await generate(["a scene", "--n", "2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    const files = readdirSync(fixture.directory).filter(
      (name) => !before.has(name) && name.endsWith(".webm")
    );
    expect(files).toHaveLength(2);
    expect(
      files
        .map((name) => readFileSync(join(fixture.directory, name), "utf8"))
        .sort()
    ).toEqual(["video1", "video2"]);
  });

  test.each(["3garbage", "Infinity", "1e309", "0"])(
    "rejects duration %s before network",
    async (duration) => {
      const result = await generate([
        "scene",
        "--duration",
        duration,
        "--json",
      ]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout).error.message).toContain("--duration");
      expect(result.requests).toHaveLength(0);
    }
  );

  test("rejects duplicate input and frame roles before network", async () => {
    const duplicate = await generate(["--image", start, "--image", end]);
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.requests).toHaveLength(0);
    const frames = await generate([
      "--frame-images",
      fixture.json([
        { image: start, frameType: "last_frame" },
        { image: end, frameType: "last_frame" },
      ]),
    ]);
    expect(frames.exitCode).toBe(1);
    expect(frames.requests).toHaveLength(0);
  });

  test("poll timeout is enforced and represented in JSON", async () => {
    const result = await generate(
      ["scene", "--poll-timeout-ms", "10", "--json"],
      "pending"
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).results[0].error.message).toContain(
      "timed out"
    );
  });
});

describe("video routing and deadlines", () => {
  test("bounds an in-flight status request by the poll deadline", async () => {
    const result = await generate(
      ["scene", "--poll-timeout-ms", "20", "--json"],
      "stalled-status"
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).results[0].error.message).toContain(
      "timed out"
    );
  });

  test("supports nested help and literal subcommand names after --", async () => {
    const help = await fixture.run(["video", "help", "status"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("<operation-file>");
    expect(help.requests).toHaveLength(0);
    const literal = await generate(["--", "start"]);
    expect(literal.exitCode).toBe(0);
    expect(
      literal.requests.find((item) => item.route.endsWith("/start")).body.prompt
    ).toBe("start");
  });

  test("validates the start destination before submitting a job", async () => {
    const result = await fixture.run([
      "video",
      "start",
      "scene",
      "--output",
      fixture.directory,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.requests).toHaveLength(0);
    expect(JSON.parse(result.stdout).error.message).toContain("JSON file");
  });

  test("rejects millisecond timer overflow before network", async () => {
    const result = await generate([
      "scene",
      "--poll-timeout-ms",
      "2147483648",
      "--json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.requests).toHaveLength(0);
  });
});

describe("video operation lifecycle", () => {
  test("persists start operation, forwards webhook, retrieves without downloading, then downloads", async () => {
    const path = join(fixture.directory, "operation.json");
    const started = await fixture.run([
      "video",
      "start",
      "scene",
      "--webhook-url",
      "https://example.com/hook",
      "--output",
      path,
      "--max-retries",
      "0",
    ]);
    expect(started.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(
      JSON.parse(started.stdout)
    );
    expect(
      started.requests.find((item) => item.route.endsWith("/start")).body
        .callbackUrl
    ).toBe("https://example.com/hook");
    const status = await fixture.run(["video", "status", path], {
      mode: "download",
    });
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).videos[0].url).toContain("movie.webm");
    expect(status.requests).toHaveLength(1);
    const downloaded = await fixture.run(
      [
        "video",
        "status",
        path,
        "--download",
        "--output",
        join(fixture.directory, "download/"),
      ],
      { mode: "download" }
    );
    expect(downloaded.exitCode).toBe(0);
    const file = JSON.parse(downloaded.stdout).results[0].videos[0].file;
    expect(file.endsWith(".webm")).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("downloaded-video");
    const limited = await fixture.run(
      ["video", "status", path, "--download", "--download-max-bytes", "2"],
      { mode: "download" }
    );
    expect(limited.exitCode).toBe(1);
    expect(JSON.parse(limited.stdout).results[0].success).toBe(false);
  });

  test("reports pending and provider errors", async () => {
    const path = fixture.json({
      model: "bytedance/seedance-2.0",
      operation: { id: "job" },
    });
    const pending = await fixture.run(["video", "status", path], {
      mode: "pending",
    });
    expect(JSON.parse(pending.stdout).status).toBe("pending");
    const error = await fixture.run(["video", "status", path], {
      mode: "status-error",
    });
    expect(error.exitCode).toBe(1);
    expect(JSON.parse(error.stdout).error).toBe("provider failed");
  });
});

describe("videoGenerationOptions", () => {
  test("parses SDK dimensions and adaptive ratio", () => {
    expect(
      videoGenerationOptions({
        aspectRatio: "adaptive",
        resolution: "1920x1080",
        duration: "5",
      })
    ).toMatchObject({
      aspectRatio: "adaptive",
      resolution: "1920x1080",
      duration: 5,
    });
    expect(() => videoGenerationOptions({ resolution: "1080p" })).toThrow(
      "--resolution"
    );
  });
});
