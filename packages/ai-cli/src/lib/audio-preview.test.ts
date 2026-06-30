import { describe, expect, test } from "bun:test";

import { decodeWav, renderWaveformLine } from "./audio-preview.js";

describe("decodeWav", () => {
  test("decodes PCM samples into amplitudes", () => {
    const wav = makePcm16Wav([0, 16_384, -32_768, 8_192], 4);
    const decoded = decodeWav(wav);

    expect(decoded).not.toBeNull();
    expect(decoded!.sampleRate).toBe(4);
    expect(decoded!.channels).toBe(1);
    expect(decoded!.durationMs).toBe(1000);
    expect(Array.from(decoded!.amplitudes)).toEqual([0, 0.5, 1, 0.25]);
  });

  test("decodes WAV files with streaming data size markers", () => {
    const wav = makePcm16Wav([0, 16_384, -32_768, 8_192], 4);
    wav.writeUInt32LE(0xffffffff, 4);
    wav.writeUInt32LE(0xffffffff, 40);

    const decoded = decodeWav(wav);

    expect(decoded).not.toBeNull();
    expect(decoded!.durationMs).toBe(1000);
    expect(Array.from(decoded!.amplitudes)).toEqual([0, 0.5, 1, 0.25]);
  });

  test("returns null for unsupported audio data", () => {
    expect(decodeWav(Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBeNull();
  });
});

describe("renderWaveformLine", () => {
  test("renders an accurate waveform from decoded amplitudes", () => {
    const decoded = decodeWav(makePcm16Wav([0, 16_384, -32_768, 8_192], 4));
    const line = renderWaveformLine(decoded!, 500, 48, "Playing audio");

    expect(line).toContain("Playing audio");
    expect(line).toContain("0:00 / 0:01");
    expect(line).toMatch(new RegExp("[\\u2581-\\u2588]", "u"));
    expect(line.length).toBeLessThanOrEqual(47);
  });
});

function makePcm16Wav(samples: number[], sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    wav.writeInt16LE(samples[i]!, 44 + i * 2);
  }

  return wav;
}
