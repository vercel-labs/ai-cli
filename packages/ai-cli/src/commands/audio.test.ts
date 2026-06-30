import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveAudioFormat, shouldPreviewAudio } from "./audio.js";

describe("resolveAudioFormat", () => {
  test("defaults to mp3", () => {
    expect(resolveAudioFormat()).toBe("mp3");
  });

  test("infers known audio formats from explicit output filenames", () => {
    expect(resolveAudioFormat(undefined, "clip.wav")).toBe("wav");
    expect(resolveAudioFormat(undefined, "clip.flac")).toBe("flac");
  });

  test("does not infer a format from output directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-cli-audio-format-"));
    try {
      expect(resolveAudioFormat(undefined, dir)).toBe("mp3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores unknown output filename extensions", () => {
    expect(resolveAudioFormat(undefined, "clip.audio")).toBe("mp3");
  });

  test("rejects conflicting explicit formats and output extensions", () => {
    expect(() => resolveAudioFormat("mp3", "clip.wav")).toThrow(
      'does not match output file extension ".wav"'
    );
  });
});

describe("shouldPreviewAudio", () => {
  test("allows saved-file previews when stdout is piped and stderr is interactive", () => {
    expect(
      shouldPreviewAudio({ output: "clip.mp3" }, false, true, undefined)
    ).toBe(true);
  });

  test("skips binary stdout pipeline output", () => {
    expect(shouldPreviewAudio({}, false, true, undefined)).toBe(false);
  });

  test("skips json output and fully disabled previews", () => {
    expect(
      shouldPreviewAudio({ json: true, output: "clip.mp3" }, true, true)
    ).toBe(false);
    expect(
      shouldPreviewAudio(
        { output: "clip.mp3", play: false, waveform: false },
        true,
        true
      )
    ).toBe(false);
  });
});
