import { statSync } from "fs";
import { readFile } from "fs/promises";
import { extname } from "path";
import { fileURLToPath } from "url";

import { gateway } from "@ai-sdk/gateway";
import { generateSpeech, transcribe } from "ai";
import type { Command } from "commander";

import { previewAudioOutputs } from "../lib/audio-preview.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import type { OutputFormat } from "../lib/output.js";
import { parseNonNegativeFloat, parsePositiveInt } from "../lib/parse.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin, stdinAsText } from "../lib/stdin.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_AUDIO_FORMAT = "mp3";
const KNOWN_AUDIO_FORMATS = new Set([
  "mp3",
  "wav",
  "opus",
  "aac",
  "flac",
  "pcm",
]);

interface SpeakOptions {
  model?: string;
  output?: string;
  format?: string;
  voice?: string;
  instructions?: string;
  speed?: string;
  language?: string;
  count?: string;
  concurrency?: string;
  quiet?: boolean;
  json?: boolean;
  play?: boolean;
  waveform?: boolean;
}

interface TranscribeOptions {
  model?: string;
  output?: string;
  format?: string;
  count?: string;
  concurrency?: string;
  quiet?: boolean;
  json?: boolean;
}

export function registerAudioCommand(program: Command) {
  const audio = program
    .command("audio")
    .description("Generate speech or transcribe audio");

  audio
    .command("speak")
    .description("Generate speech audio from text")
    .argument("[text]", "Text to convert to speech")
    .option(
      "-m, --model <model>",
      "Speech model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option("-f, --format <fmt>", "Audio output format (default: mp3)")
    .option("--voice <voice>", "Voice to use for speech generation")
    .option("--instructions <text>", "Instructions for speech generation")
    .option("--speed <n>", "Speech speed")
    .option("--language <code>", "Language code (e.g. en, fr) or auto")
    .option("-n, --count <n>", "Number of generations per model (default: 1)")
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    )
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .option("--no-play", "Disable audio playback after generation")
    .option("--no-waveform", "Disable accurate terminal waveform preview")
    .action(async (rawText: string | undefined, opts: SpeakOptions) => {
      const text = rawText?.trim() || undefined;
      const stdin = await readStdin();
      const stdinText = stdin ? stdinAsText(stdin).trim() : undefined;
      const speechText = buildSpeechText(text, stdinText);

      if (!speechText) {
        process.stderr.write(
          "Error: text or stdin is required (provide text or pipe text via stdin)\n"
        );
        process.exit(1);
      }

      const outputFormat = resolveAudioFormat(opts.format, opts.output);
      const speed = opts.speed
        ? parseNonNegativeFloat(opts.speed, "speed")
        : undefined;
      const gatewayModels = await fetchGatewayModels();
      const models = resolveModels("speech", opts.model, gatewayModels.speech);
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const jobs = buildJobs(models, countPerModel);
      const previewAudio = shouldPreviewAudio(opts);

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
          const result = await generateSpeech({
            headers: gatewayHeaders(),
            model: gateway.speechModel(modelId),
            text: speechText,
            voice: opts.voice ?? defaultVoiceForModel(modelId),
            outputFormat,
            instructions: opts.instructions,
            speed,
            language: opts.language,
            abortSignal: abort,
          });
          return {
            data: Buffer.from(result.audio.uint8Array),
            id: responseIdFromHeaders(result.responses[0]?.headers),
          };
        },
        {
          noun: "audio",
          format: "audio",
          extension: extensionForAudioFormat(outputFormat),
          outputPath: opts.output,
          quiet: opts.quiet,
          json: opts.json,
          concurrency: opts.concurrency
            ? parsePositiveInt(opts.concurrency, "concurrency")
            : DEFAULT_CONCURRENCY,
          afterOutputs: previewAudio
            ? (outputs) =>
                previewAudioOutputs(outputs, {
                  play: opts.play !== false,
                  waveform: opts.waveform !== false,
                  quiet: opts.quiet,
                })
            : undefined,
        }
      );
      if (failed === total) process.exit(1);
      if (failed > 0) process.exit(2);
    });

  audio
    .command("transcribe")
    .description("Transcribe audio to text")
    .argument("[audio]", "Audio file path or URL")
    .option(
      "-m, --model <model>",
      "Transcription model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option("-f, --format <fmt>", "Output format: md, txt (default: txt)")
    .option(
      "-n, --count <n>",
      "Number of transcriptions per model (default: 1)"
    )
    .option(
      "-p, --concurrency <n>",
      `Max parallel transcriptions (default: ${DEFAULT_CONCURRENCY})`
    )
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .action(async (rawAudio: string | undefined, opts: TranscribeOptions) => {
      const stdin = await readStdin();
      if (!rawAudio && !stdin) {
        process.stderr.write(
          "Error: audio file, URL, or stdin is required (provide an audio path/URL or pipe audio via stdin)\n"
        );
        process.exit(1);
      }

      let audioInput: Uint8Array | URL;
      try {
        audioInput = await loadAudioInput(rawAudio, stdin);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }

      const format = resolveTranscriptFormat(opts.format);
      const gatewayModels = await fetchGatewayModels();
      const models = resolveModels(
        "transcription",
        opts.model,
        gatewayModels.transcription
      );
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const jobs = buildJobs(models, countPerModel);

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
          const result = await transcribe({
            headers: gatewayHeaders(),
            model: gateway.transcriptionModel(modelId),
            audio: audioInput,
            abortSignal: abort,
          });
          return {
            data: result.text,
            id: responseIdFromHeaders(result.responses[0]?.headers),
          };
        },
        {
          noun: "transcript",
          format,
          outputPath: opts.output,
          quiet: opts.quiet,
          json: opts.json,
          concurrency: opts.concurrency
            ? parsePositiveInt(opts.concurrency, "concurrency")
            : DEFAULT_CONCURRENCY,
        }
      );
      if (failed === total) process.exit(1);
      if (failed > 0) process.exit(2);
    });
}

function buildSpeechText(
  text?: string,
  stdinText?: string
): string | undefined {
  if (stdinText && text) return `${stdinText}\n\n${text}`;
  return stdinText || text;
}

export function resolveAudioFormat(
  format?: string,
  outputPath?: string
): string {
  const outputPathFormat = audioFormatFromOutputPath(outputPath);
  if (!format) return outputPathFormat ?? DEFAULT_AUDIO_FORMAT;

  const normalized = format.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(
      `--format must be a valid audio format name (got "${format}")`
    );
  }
  if (outputPathFormat && outputPathFormat !== normalized) {
    throw new Error(
      `--format "${normalized}" does not match output file extension ".${outputPathFormat}"`
    );
  }

  return normalized;
}

export function shouldPreviewAudio(
  opts: Pick<SpeakOptions, "json" | "output" | "play" | "waveform" | "quiet">,
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  stderrIsTTY = Boolean(process.stderr.isTTY),
  envOutputDir = process.env.AI_CLI_OUTPUT_DIR
): boolean {
  if (opts.json) return false;

  const playRequested = opts.play !== false;
  const waveformRequested = opts.waveform !== false && !opts.quiet;
  if (!playRequested && !waveformRequested) return false;

  const hasSavedOutput = Boolean(opts.output || envOutputDir);
  if (!stdoutIsTTY && !hasSavedOutput) return false;

  return stderrIsTTY;
}

function audioFormatFromOutputPath(outputPath?: string): string | undefined {
  if (!outputPath || isExistingDirectory(outputPath)) return undefined;

  const extension = extname(outputPath).slice(1).toLowerCase();
  if (!extension || !KNOWN_AUDIO_FORMATS.has(extension)) return undefined;

  return extension;
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function extensionForAudioFormat(format: string): string {
  return `.${format}`;
}

function resolveTranscriptFormat(format?: string): OutputFormat {
  if (!format || format === "txt") return "txt";
  if (format === "md") return "md";
  throw new Error(`--format must be one of: md, txt (got "${format}")`);
}

async function loadAudioInput(
  rawAudio: string | undefined,
  stdin: Uint8Array | null
): Promise<Uint8Array | URL> {
  if (stdin) return new Uint8Array(stdin);
  const audio = rawAudio?.trim();
  if (!audio) throw new Error("audio file, URL, or stdin is required");

  const url = parseUrl(audio);
  if (url?.protocol === "http:" || url?.protocol === "https:") return url;
  if (url?.protocol === "file:")
    return new Uint8Array(await readFile(fileURLToPath(url)));
  if (url) throw new Error(`unsupported audio URL protocol "${url.protocol}"`);

  try {
    return new Uint8Array(await readFile(audio));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read audio file "${audio}": ${reason}`);
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function defaultVoiceForModel(modelId: string): string | undefined {
  return modelId.startsWith("openai/") ? "alloy" : undefined;
}

function gatewayHeaders(): Record<string, string> {
  return {
    "http-referer": "https://github.com/vercel-labs/ai-cli",
    "x-title": "ai-cli",
  };
}
