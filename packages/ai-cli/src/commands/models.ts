import type { Command } from "commander";

import {
  formatLatency,
  formatPerUnitPrice,
  formatPricePerMillion,
  formatReleaseDate,
  formatThroughput,
  formatTokenCount,
  formatUptime,
  formatWebSearchPrice,
} from "../lib/format.js";
import {
  expandModelId,
  fetchGatewayModels,
  fetchModelEndpoints,
  type Modality,
  type ModelEntry,
} from "../lib/models.js";

type ModelFilter = Modality | "audio";

function groupByCreator(models: ModelEntry[]): Map<string, ModelEntry[]> {
  const groups = new Map<string, ModelEntry[]>();
  for (const m of models) {
    if (!groups.has(m.creator)) groups.set(m.creator, []);
    groups.get(m.creator)!.push(m);
  }
  return new Map(
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function modelName(id: string): string {
  const slash = id.indexOf("/");
  return slash !== -1 ? id.slice(slash + 1) : id;
}

function pricingString(pricing: ModelEntry["pricing"], key: string) {
  const value = pricing?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function showModelInfo(input: string, json: boolean): Promise<void> {
  const gatewayModels = await fetchGatewayModels();
  const id = expandModelId(input, gatewayModels.all);
  const entry = gatewayModels.all.find((m) => m.id === id);
  if (!entry) {
    process.stderr.write(
      `Error: model not found: ${input}\nRun "ai models" to list available models\n`
    );
    process.exit(1);
  }

  const endpointsInfo = await fetchModelEndpoints(entry.id);

  if (json) {
    const output = {
      id: entry.id,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      creator: entry.creator,
      capabilities: entry.capabilities,
      ...(entry.tags ? { tags: entry.tags } : {}),
      ...(entry.contextWindow != null
        ? { contextWindow: entry.contextWindow }
        : {}),
      ...(entry.maxTokens != null ? { maxTokens: entry.maxTokens } : {}),
      ...(entry.released != null ? { released: entry.released } : {}),
      ...(entry.pricing ? { pricing: entry.pricing } : {}),
      ...(endpointsInfo && endpointsInfo.endpoints.length > 0
        ? { endpoints: endpointsInfo.endpoints }
        : {}),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return;
  }

  process.stdout.write(
    entry.name ? `\n${entry.name}  ${entry.id}\n` : `\n${entry.id}\n`
  );

  const meta: string[] = [];
  if (entry.released != null)
    meta.push(`Released ${formatReleaseDate(entry.released)}`);
  if (entry.tags) meta.push(...entry.tags);
  if (meta.length > 0) process.stdout.write(`${meta.join(" · ")}\n`);
  if (entry.description) process.stdout.write(`\n${entry.description}\n`);

  const rows: [string, string][] = [];
  if (entry.contextWindow)
    rows.push(["Context", formatTokenCount(entry.contextWindow)]);
  if (entry.maxTokens)
    rows.push(["Max output", formatTokenCount(entry.maxTokens)]);

  const tokenPrices: [string, string][] = [
    ["Input", "input"],
    ["Output", "output"],
    ["Cache read", "input_cache_read"],
    ["Cache write", "input_cache_write"],
  ];
  for (const [label, key] of tokenPrices) {
    const value = pricingString(entry.pricing, key);
    if (value) rows.push([label, formatPricePerMillion(value)]);
  }
  const webSearch = pricingString(entry.pricing, "web_search");
  if (webSearch && Number.parseFloat(webSearch) > 0)
    rows.push(["Web search", formatWebSearchPrice(webSearch)]);
  const imagePrice = pricingString(entry.pricing, "image");
  if (imagePrice) rows.push(["Image", formatPerUnitPrice(imagePrice, "image")]);

  if (rows.length > 0) {
    const width = Math.max(...rows.map(([label]) => label.length));
    process.stdout.write("\n");
    for (const [label, value] of rows) {
      process.stdout.write(`  ${label.padEnd(width + 2)}${value}\n`);
    }
  }

  const endpoints = endpointsInfo?.endpoints ?? [];
  if (endpoints.length > 0) {
    const table: string[][] = [
      ["provider", "context", "latency", "throughput", "uptime"],
    ];
    for (const ep of endpoints) {
      table.push([
        ep.provider_name ?? "unknown",
        ep.context_length ? formatTokenCount(ep.context_length) : "—",
        ep.latency_last_1h?.p50 != null
          ? formatLatency(ep.latency_last_1h.p50)
          : "—",
        ep.throughput_last_1h?.p50 != null
          ? formatThroughput(ep.throughput_last_1h.p50)
          : "—",
        ep.uptime_last_1d != null ? formatUptime(ep.uptime_last_1d) : "—",
      ]);
    }
    const widths = table[0].map((_, col) =>
      Math.max(...table.map((row) => row[col].length))
    );
    process.stdout.write("\nProviders\n");
    for (const row of table) {
      const line = row
        .map((cell, col) => cell.padEnd(widths[col] + 2))
        .join("")
        .trimEnd();
      process.stdout.write(`  ${line}\n`);
    }
  }

  process.stdout.write("\n");
}

export function registerModelsCommand(program: Command) {
  program
    .command("models")
    .description("List available models from AI Gateway")
    .argument(
      "[model]",
      "Show detailed info for a model (e.g. anthropic/claude-opus-4.6)"
    )
    .option(
      "--type <type>",
      "Filter by type: text, image, video, audio, speech, transcription"
    )
    .option("--creator <name>", "Filter by creator (e.g. openai, google)")
    .option("--json", "Output as JSON (includes descriptions)")
    .action(
      async (
        model: string | undefined,
        opts: { type?: string; creator?: string; json?: boolean }
      ) => {
        if (model) {
          if (opts.type || opts.creator) {
            process.stderr.write(
              "Error: --type and --creator cannot be used with a model argument\n"
            );
            process.exit(1);
          }
          await showModelInfo(model, opts.json ?? false);
          return;
        }
        const validTypes = [
          "text",
          "image",
          "video",
          "audio",
          "speech",
          "transcription",
        ];
        const filterType = opts.type?.toLowerCase() as ModelFilter | undefined;
        if (filterType && !validTypes.includes(filterType)) {
          process.stderr.write(
            `Error: --type must be one of: ${validTypes.join(", ")} (got "${opts.type}")\n`
          );
          process.exit(1);
        }
        const filterCreator = opts.creator?.toLowerCase();

        const gatewayModels = await fetchGatewayModels();

        if (opts.json) {
          let entries = gatewayModels.all;
          if (filterType) {
            entries = entries.filter((m) =>
              filterType === "audio"
                ? m.capabilities.includes("speech") ||
                  m.capabilities.includes("transcription")
                : m.capabilities.includes(filterType)
            );
          }
          if (filterCreator) {
            entries = entries.filter(
              (m) => m.creator.toLowerCase() === filterCreator
            );
          }
          const output = entries.map((m) => ({
            id: m.id,
            ...(m.name ? { name: m.name } : {}),
            ...(m.description ? { description: m.description } : {}),
            creator: m.creator,
            capabilities: m.capabilities,
            ...(m.pricing ? { pricing: m.pricing } : {}),
          }));
          process.stdout.write(JSON.stringify(output, null, 2) + "\n");
          return;
        }

        const sections: { title: string; entries: ModelEntry[] }[] = [];
        if (!filterType || filterType === "text")
          sections.push({ title: "Text", entries: gatewayModels.text });
        if (!filterType || filterType === "image")
          sections.push({ title: "Image", entries: gatewayModels.image });
        if (!filterType || filterType === "video")
          sections.push({ title: "Video", entries: gatewayModels.video });
        if (!filterType || filterType === "audio" || filterType === "speech")
          sections.push({ title: "Speech", entries: gatewayModels.speech });
        if (
          !filterType ||
          filterType === "audio" ||
          filterType === "transcription"
        )
          sections.push({
            title: "Transcription",
            entries: gatewayModels.transcription,
          });

        let totalCount = 0;
        for (const section of sections) {
          let entries = section.entries;
          if (filterCreator) {
            entries = entries.filter(
              (m) => m.creator.toLowerCase() === filterCreator
            );
          }
          const grouped = groupByCreator(entries);
          const count = [...grouped.values()].reduce((s, m) => s + m.length, 0);
          if (count === 0) continue;
          totalCount += count;
          process.stdout.write(`\n${section.title} models (${count}):\n`);
          for (const [creator, models] of grouped) {
            process.stdout.write(`\n  ${creator}\n`);
            for (const m of models) {
              process.stdout.write(`    ${modelName(m.id)}\n`);
            }
          }
        }

        if (totalCount === 0) {
          process.stderr.write("No models found matching filters\n");
        } else {
          process.stdout.write("\n");
        }
      }
    );
}
