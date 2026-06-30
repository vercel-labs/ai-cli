import { describe, expect, test } from "bun:test";

import {
  decodeWav,
  playerCandidates,
  renderWaveformLine,
  startWaveformRenderer,
} from "./audio-preview.js";

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
    expect(stripAnsi(line).length).toBeLessThanOrEqual(47);
  });

  test("caps the waveform timeline on wide terminals", () => {
    const decoded = decodeWav(makePcm16Wav([0, 16_384, -32_768, 8_192], 4));
    const line = stripAnsi(
      renderWaveformLine(decoded!, 500, 180, "Playing audio")
    );
    const suffix = " 0:00 / 0:01";
    const waveform = line.slice("Playing audio ".length, -suffix.length);

    expect(waveform).toHaveLength(80);
  });
});

describe("startWaveformRenderer", () => {
  test("hides the terminal cursor while playback is rendering", () => {
    const decoded = decodeWav(makePcm16Wav([0, 16_384, -32_768, 8_192], 4));
    const stderr = withStderrTTY(true, () =>
      captureStderr(() => {
        const stop = startWaveformRenderer(decoded!, "Playing audio");
        stop(true);
      })
    );

    expect(stderr).toContain("\x1b[?25l");
    expect(stderr).toContain("\x1b[?25h");
    expect(stderr.indexOf("\x1b[?25l")).toBeLessThan(
      stderr.indexOf("\x1b[?25h")
    );
  });
});

describe("playerCandidates", () => {
  test("uses Windows MediaPlayer for mp3 playback", () => {
    const candidates = playerCandidates("clip.mp3", "win32");
    const powershellScripts = candidates
      .filter((candidate) => candidate.command === "powershell.exe")
      .map((candidate) => candidate.args.join(" "));

    expect(powershellScripts[0]).toContain("System.Windows.Media.MediaPlayer");
    expect(powershellScripts.join(" ")).not.toContain(
      "System.Media.SoundPlayer"
    );
  });

  test("keeps Windows SoundPlayer as a wav fallback only", () => {
    const candidates = playerCandidates("clip.wav", "win32");
    const powershellScripts = candidates
      .filter((candidate) => candidate.command === "powershell.exe")
      .map((candidate) => candidate.args.join(" "));

    expect(powershellScripts[0]).toContain("System.Windows.Media.MediaPlayer");
    expect(powershellScripts.join(" ")).toContain("System.Media.SoundPlayer");
  });

  test("prefers decode-capable Linux players for mp3 playback", () => {
    const commands = playerCandidates("clip.mp3", "linux").map(
      (candidate) => candidate.command
    );

    expect(commands.slice(0, 3)).toEqual(["ffplay", "mpv", "play"]);
    expect(commands).not.toContain("aplay");
    expect(commands).not.toContain("paplay");
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

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function captureStderr(fn: () => void): string {
  const originalWrite = process.stderr.write;
  let output = "";
  (
    process.stderr as {
      write: (chunk: string | Uint8Array) => boolean;
    }
  ).write = (chunk) => {
    output +=
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };

  try {
    fn();
  } finally {
    (
      process.stderr as {
        write: typeof originalWrite;
      }
    ).write = originalWrite;
  }

  return output;
}

function withStderrTTY<T>(isTTY: boolean, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: isTTY,
  });

  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stderr, "isTTY", descriptor);
    } else {
      delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
  }
}
