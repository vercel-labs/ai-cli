import {
  supportsKittyGraphics,
  displayImage,
  displayVideoFrame,
} from "./kitty.js";
import type { OutputFormat } from "./output.js";
import { writeOutput } from "./output.js";
import { pMap } from "./p-map.js";
import { Progress, MultiProgress, formatElapsed } from "./progress.js";

export interface Job {
  modelId: string;
  label: string;
  index: number;
}

export interface RunJobsOptions {
  noun: string;
  format: OutputFormat;
  outputPath?: string;
  extension?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency: number;
  display?: boolean;
  afterOutputs?: (outputs: RunJobOutput[]) => Promise<void> | void;
}

export interface RunJobOutput {
  index: number;
  model: string;
  label: string;
  data: Buffer | string;
  file: string | null;
  elapsed_ms: number;
}

export function buildJobs(models: string[], countPerModel: number): Job[] {
  let jobIndex = 0;
  return models.flatMap((modelId) =>
    Array.from({ length: countPerModel }, (_, i) => ({
      modelId,
      label: models.length > 1 ? `${modelId} #${i + 1}` : `#${i + 1}`,
      index: jobIndex++,
    }))
  );
}

export interface RunJobsResult {
  total: number;
  failed: number;
}

export interface GeneratedOutput {
  data: Buffer | string;
  id?: string;
}

type GenerateResult = Buffer | string | GeneratedOutput;

export async function runJobs(
  jobs: Job[],
  generate: (modelId: string) => Promise<GenerateResult>,
  opts: RunJobsOptions
): Promise<RunJobsResult> {
  const {
    noun,
    format,
    outputPath,
    extension,
    quiet,
    json,
    concurrency,
    display,
    afterOutputs,
  } = opts;

  if (jobs.length === 1) {
    const job = jobs[0];
    const { modelId } = job;
    const progress = new Progress(quiet);
    const start = Date.now();
    progress.start(`Generating ${noun} with ${modelId}`);

    try {
      const generated = normalizeGeneratedOutput(await generate(modelId));
      const elapsed = Date.now() - start;
      progress.stop(`Generated ${noun} with ${modelId}`);

      if (json) {
        const path = await writeOutput({
          data: generated.data,
          format,
          outputPath,
          outputId: generated.id,
          extension,
          forceFile: true,
          quiet: true,
          display: false,
        });
        const meta = {
          elapsed_ms: elapsed,
          count: 1,
          results: [
            {
              index: 1,
              model: modelId,
              elapsed_ms: elapsed,
              success: true,
              file: path,
            },
          ],
        };
        process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
      } else {
        const path = await writeOutput({
          data: generated.data,
          format,
          outputPath,
          outputId: generated.id,
          extension,
          quiet,
          display,
        });
        await afterOutputs?.([
          {
            index: 0,
            model: modelId,
            label: job.label,
            data: generated.data,
            file: path,
            elapsed_ms: elapsed,
          },
        ]);
      }
    } catch (err) {
      progress.stop();
      throw err;
    }
    return { total: 1, failed: 0 };
  }

  const multi = new MultiProgress(quiet);
  const start = Date.now();
  const shouldDisplay =
    !json &&
    display !== false &&
    (format === "image" || format === "video") &&
    process.stdout.isTTY &&
    supportsKittyGraphics();

  const lineIdxs = jobs.map((j) =>
    multi.addLine(`Generating ${noun} ${j.label} with ${j.modelId}`)
  );

  const results: {
    index: number;
    model: string;
    success: boolean;
    elapsed_ms: number;
    file: string | null;
  }[] = [];
  const outputs: RunJobOutput[] = [];
  const pendingDisplayBuffers: Buffer[] = [];

  await pMap(
    jobs,
    async (job, i) => {
      multi.startLine(lineIdxs[i]);
      const genStart = Date.now();
      try {
        const generated = normalizeGeneratedOutput(await generate(job.modelId));
        const genElapsed = Date.now() - genStart;
        const suffix = `${i + 1}`;
        const path = await writeOutput({
          data: generated.data,
          format,
          outputPath,
          outputId: generated.id,
          suffix,
          extension,
          forceFile: Boolean(json),
          quiet: true,
          display: false,
        });
        if (shouldDisplay && Buffer.isBuffer(generated.data))
          pendingDisplayBuffers.push(generated.data);
        const savedMsg = path
          ? `Saved to ${path}`
          : `${noun[0].toUpperCase()}${noun.slice(1)} ${job.label} written to stdout`;
        multi.completeLine(
          lineIdxs[i],
          `${savedMsg} (${formatElapsed(genElapsed)})`
        );
        results.push({
          index: i,
          model: job.modelId,
          success: true,
          elapsed_ms: genElapsed,
          file: path,
        });
        outputs.push({
          index: i,
          model: job.modelId,
          label: job.label,
          data: generated.data,
          file: path,
          elapsed_ms: genElapsed,
        });
      } catch (err: unknown) {
        const genElapsed = Date.now() - genStart;
        const msg = err instanceof Error ? err.message : String(err);
        multi.completeLine(
          lineIdxs[i],
          `${noun[0].toUpperCase()}${noun.slice(1)} ${job.label} failed: ${msg} (${formatElapsed(genElapsed)})`
        );
        results.push({
          index: i,
          model: job.modelId,
          success: false,
          elapsed_ms: genElapsed,
          file: null,
        });
      }
    },
    concurrency
  );

  if (json) {
    const totalElapsed = Date.now() - start;
    const orderedResults = [...results].sort((a, b) => a.index - b.index);
    const meta = {
      elapsed_ms: totalElapsed,
      count: orderedResults.filter((r) => r.success).length,
      results: orderedResults.map((r) => ({
        index: r.index + 1,
        model: r.model,
        elapsed_ms: r.elapsed_ms,
        success: r.success,
        file: r.file,
      })),
    };
    process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
  }

  if (!json && afterOutputs) {
    await afterOutputs([...outputs].sort((a, b) => a.index - b.index));
  }

  for (const buf of pendingDisplayBuffers) {
    if (format === "video") {
      await displayVideoFrame(buf);
    } else {
      displayImage(buf);
    }
  }

  const failCount = results.filter((r) => !r.success).length;
  return { total: results.length, failed: failCount };
}

function normalizeGeneratedOutput(result: GenerateResult): GeneratedOutput {
  if (typeof result === "string" || Buffer.isBuffer(result)) {
    return { data: result };
  }

  return result;
}
