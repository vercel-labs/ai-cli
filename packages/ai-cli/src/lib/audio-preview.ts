import { spawn } from "child_process";
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { delimiter, isAbsolute, join, sep } from "path";

import { isColorEnabled } from "./color.js";
import type { RunJobOutput } from "./jobs.js";

const WAVE_LEVELS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
const MIN_WAVEFORM_WIDTH = 8;

interface PlayerCommand {
  command: string;
  args: string[];
}

interface DecoderCommand {
  command: string;
  args: string[];
}

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  durationMs: number;
  amplitudes: Float32Array;
}

export interface AudioPreviewOptions {
  play: boolean;
  waveform: boolean;
  quiet?: boolean;
}

export async function previewAudioOutputs(
  outputs: RunJobOutput[],
  opts: AudioPreviewOptions
): Promise<void> {
  if (!opts.play && !opts.waveform) return;

  for (const output of outputs) {
    await previewAudioOutput(output, outputs.length, opts);
  }
}

async function previewAudioOutput(
  output: RunJobOutput,
  outputCount: number,
  opts: AudioPreviewOptions
): Promise<void> {
  const decoded = opts.waveform ? await decodeAudioForWaveform(output) : null;
  const canRenderWaveform = Boolean(decoded && isTTY() && !opts.quiet);

  if (opts.waveform && !decoded && isTTY() && !opts.quiet) {
    process.stderr.write(
      "Warning: could not decode audio for waveform preview; install ffmpeg or use --no-waveform\n"
    );
  }

  if (!opts.play) {
    if (decoded && isTTY() && !opts.quiet) {
      process.stderr.write(
        `${renderWaveformLine(decoded, decoded.durationMs, getColumns(), "Audio waveform")}\n`
      );
    }
    return;
  }

  if (!output.file) {
    if (!opts.quiet) {
      process.stderr.write(
        "Warning: audio playback requires a saved file; use -o or run in an interactive terminal\n"
      );
    }
    return;
  }

  await playAudioFile(output.file, {
    decoded: canRenderWaveform ? decoded : null,
    label: outputCount > 1 ? `Playing audio ${output.label}` : "Playing audio",
    quiet: opts.quiet,
  });
}

async function decodeAudioForWaveform(
  output: RunJobOutput
): Promise<DecodedWav | null> {
  if (Buffer.isBuffer(output.data)) {
    const decoded = decodeWav(output.data);
    if (decoded) return decoded;
  }

  if (!output.file) return null;
  return decodeAudioFileForWaveform(output.file);
}

async function decodeAudioFileForWaveform(
  file: string
): Promise<DecodedWav | null> {
  const dir = mkdtempSync(join(tmpdir(), "ai-cli-audio-"));
  const wavPath = join(dir, "decoded.wav");

  try {
    for (const candidate of decoderCandidates(file, wavPath).filter(
      (candidate) => commandExists(candidate.command)
    )) {
      const decoded = await runDecoder(candidate, wavPath);
      if (decoded) return decoded;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return null;
}

function decoderCandidates(file: string, wavPath: string): DecoderCommand[] {
  return [
    {
      command: "ffmpeg",
      args: ["-v", "error", "-y", "-i", file, "-f", "wav", wavPath],
    },
    { command: "mpg123", args: ["-q", "-w", wavPath, file] },
    { command: "sox", args: [file, wavPath] },
    {
      command: "afconvert",
      args: ["-f", "WAVE", "-d", "LEI16", file, wavPath],
    },
  ];
}

function runDecoder(
  candidate: DecoderCommand,
  wavPath: string
): Promise<DecodedWav | null> {
  return new Promise((resolve) => {
    const child = spawn(candidate.command, candidate.args, {
      stdio: "ignore",
    });

    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      try {
        resolve(decodeWav(readFileSync(wavPath)));
      } catch {
        resolve(null);
      }
    });
  });
}

interface PlayAudioFileOptions {
  decoded: DecodedWav | null;
  label: string;
  quiet?: boolean;
}

async function playAudioFile(
  file: string,
  opts: PlayAudioFileOptions
): Promise<void> {
  const candidates = playerCandidates(file).filter((candidate) =>
    commandExists(candidate.command)
  );

  if (candidates.length === 0) {
    if (!opts.quiet) {
      process.stderr.write(
        "Warning: could not find an audio player for preview; use --no-play to suppress playback\n"
      );
    }
    return;
  }

  for (const candidate of candidates) {
    const played = await runPlayer(candidate, opts);
    if (played) return;
  }

  if (!opts.quiet) {
    process.stderr.write(
      "Warning: audio player exited before playback completed; saved file is still available\n"
    );
  }
}

function playerCandidates(file: string): PlayerCommand[] {
  if (process.platform === "darwin") {
    return [{ command: "afplay", args: [file] }];
  }

  if (process.platform === "win32") {
    return [
      {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          "$player = New-Object System.Media.SoundPlayer; $player.SoundLocation = $args[0]; $player.Load(); $player.PlaySync()",
          file,
        ],
      },
    ];
  }

  return [
    { command: "paplay", args: [file] },
    { command: "aplay", args: [file] },
    {
      command: "ffplay",
      args: ["-nodisp", "-autoexit", "-loglevel", "quiet", file],
    },
    { command: "mpv", args: ["--no-video", "--really-quiet", file] },
    { command: "play", args: ["-q", file] },
  ];
}

function runPlayer(
  candidate: PlayerCommand,
  opts: PlayAudioFileOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    const stopRenderer = opts.decoded
      ? startWaveformRenderer(opts.decoded, opts.label)
      : null;
    const child = spawn(candidate.command, candidate.args, {
      stdio: "ignore",
    });

    child.on("error", () => {
      stopRenderer?.(false);
      resolve(false);
    });
    child.on("exit", (code) => {
      stopRenderer?.(code === 0);
      resolve(code === 0);
    });
  });
}

function startWaveformRenderer(
  decoded: DecodedWav,
  label: string
): (complete: boolean) => void {
  const start = Date.now();
  const render = (elapsedMs: number) => {
    process.stderr.write(
      `\r${renderWaveformLine(decoded, elapsedMs, getColumns(), label)}\x1b[K`
    );
  };

  render(0);
  const interval = setInterval(() => {
    render(Math.min(Date.now() - start, decoded.durationMs));
  }, 50);

  return (complete: boolean) => {
    clearInterval(interval);
    render(complete ? decoded.durationMs : Date.now() - start);
    process.stderr.write("\n");
  };
}

export function decodeWav(
  data: Buffer | Uint8Array<ArrayBufferLike>
): DecodedWav | null {
  if (data.byteLength < 44) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    return null;
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const chunkId = readAscii(view, offset, 4);
    const rawChunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    const chunkSize =
      rawChunkSize === 0xffffffff && chunkId === "data"
        ? view.byteLength - chunkDataOffset
        : rawChunkSize;
    const nextOffset =
      rawChunkSize === 0xffffffff && chunkId === "data"
        ? view.byteLength
        : chunkDataOffset + chunkSize + (chunkSize % 2);
    if (chunkDataOffset + chunkSize > view.byteLength) return null;

    if (chunkId === "fmt ") {
      if (chunkSize < 16) return null;
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      blockAlign = view.getUint16(chunkDataOffset + 12, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = nextOffset;
  }

  if (
    dataOffset < 0 ||
    channels <= 0 ||
    sampleRate <= 0 ||
    blockAlign <= 0 ||
    (audioFormat !== 1 && audioFormat !== 3)
  ) {
    return null;
  }

  const bytesPerSample = bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) return null;
  if (blockAlign < bytesPerSample * channels) return null;

  const frameCount = Math.floor(dataSize / blockAlign);
  const amplitudes = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const frameOffset = dataOffset + frame * blockAlign;
    let amplitude = 0;

    for (let channel = 0; channel < channels; channel++) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      const sample = readSample(view, sampleOffset, bitsPerSample, audioFormat);
      if (sample === null) return null;
      amplitude = Math.max(amplitude, Math.abs(sample));
    }

    amplitudes[frame] = Math.min(1, amplitude);
  }

  return {
    sampleRate,
    channels,
    durationMs: (frameCount / sampleRate) * 1000,
    amplitudes,
  };
}

function readSample(
  view: DataView,
  offset: number,
  bitsPerSample: number,
  audioFormat: number
): number | null {
  if (offset + bitsPerSample / 8 > view.byteLength) return null;

  if (audioFormat === 3) {
    if (bitsPerSample === 32) return clampSample(view.getFloat32(offset, true));
    if (bitsPerSample === 64) return clampSample(view.getFloat64(offset, true));
    return null;
  }

  if (bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
  if (bitsPerSample === 16) return view.getInt16(offset, true) / 32768;
  if (bitsPerSample === 24) {
    let value =
      view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value / 8388608;
  }
  if (bitsPerSample === 32) return view.getInt32(offset, true) / 2147483648;

  return null;
}

function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function renderWaveformLine(
  decoded: DecodedWav,
  elapsedMs: number,
  columns: number,
  label: string
): string {
  const suffix = ` ${formatTimestamp(elapsedMs)} / ${formatTimestamp(
    decoded.durationMs
  )}`;
  const minTextWidth = suffix.length + MIN_WAVEFORM_WIDTH + 1;
  const maxLabelWidth = Math.max(0, columns - minTextWidth - 1);
  const displayLabel =
    label.length > maxLabelWidth ? label.slice(0, maxLabelWidth) : label;
  const prefix = displayLabel ? `${displayLabel} ` : "";
  const width = columns - prefix.length - suffix.length - 1;

  if (width < MIN_WAVEFORM_WIDTH) {
    return `${displayLabel}${suffix}`.slice(0, Math.max(0, columns - 1));
  }

  return `${prefix}${waveformBars(decoded, elapsedMs, width)}${suffix}`;
}

function waveformBars(
  decoded: DecodedWav,
  elapsedMs: number,
  width: number
): string {
  const playhead = Math.min(
    width - 1,
    Math.max(
      0,
      Math.floor((elapsedMs / Math.max(decoded.durationMs, 1)) * width)
    )
  );
  let bars = "";

  for (let i = 0; i < width; i++) {
    const bar = barForAmplitude(columnAmplitude(decoded.amplitudes, i, width));
    bars += i === playhead && isColorEnabled() ? `\x1b[7m${bar}\x1b[0m` : bar;
  }

  return bars;
}

function columnAmplitude(
  amplitudes: Float32Array,
  column: number,
  width: number
): number {
  if (amplitudes.length === 0) return 0;

  const start = Math.floor((column / width) * amplitudes.length);
  const end = Math.max(
    start + 1,
    Math.floor(((column + 1) / width) * amplitudes.length)
  );
  let peak = 0;

  for (let i = start; i < end && i < amplitudes.length; i++) {
    peak = Math.max(peak, amplitudes[i] ?? 0);
  }

  return peak;
}

function barForAmplitude(amplitude: number): string {
  const level = Math.max(
    0,
    Math.min(
      WAVE_LEVELS.length - 1,
      Math.round(amplitude * (WAVE_LEVELS.length - 1))
    )
  );
  return WAVE_LEVELS[level]!;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(view.getUint8(offset + i));
  }
  return result;
}

function isTTY(): boolean {
  return !!process.stderr.isTTY;
}

function getColumns(): number {
  return (
    (process.stderr as typeof process.stderr & { columns?: number }).columns ??
    80
  );
}

function commandExists(command: string): boolean {
  if (command.includes(sep) || isAbsolute(command)) {
    return isExecutable(command);
  }

  const pathEnv = process.env.PATH;
  if (!pathEnv) return false;

  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
      : [""];

  for (const dir of pathEnv.split(delimiter)) {
    for (const ext of extensions) {
      if (isExecutable(join(dir, `${command}${ext}`))) return true;
    }
  }

  return false;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
