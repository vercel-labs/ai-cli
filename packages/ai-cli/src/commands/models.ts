import type { Command } from "commander";

import { fetchGatewayModels, type ModelEntry } from "../lib/models.js";

function groupByProvider(models: ModelEntry[]): Map<string, ModelEntry[]> {
  const groups = new Map<string, ModelEntry[]>();
  for (const m of models) {
    const slash = m.id.indexOf("/");
    const provider = slash !== -1 ? m.id.slice(0, slash) : "other";
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)!.push(m);
  }
  return new Map(
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function modelName(id: string): string {
  const slash = id.indexOf("/");
  return slash !== -1 ? id.slice(slash + 1) : id;
}

export function registerModelsCommand(program: Command) {
  program
    .command("models")
    .description("List available models from AI Gateway")
    .option("--type <type>", "Filter by type: text, image, video")
    .option("--provider <name>", "Filter by provider (e.g. openai, google)")
    .option("--json", "Output as JSON (includes descriptions)")
    .action(
      async (opts: { type?: string; provider?: string; json?: boolean }) => {
        const validTypes = ["text", "image", "video"];
        const filterType = opts.type?.toLowerCase();
        if (filterType && !validTypes.includes(filterType)) {
          process.stderr.write(
            `Error: --type must be one of: ${validTypes.join(", ")} (got "${opts.type}")\n`
          );
          process.exit(1);
        }
        const filterProvider = opts.provider?.toLowerCase();

        const gatewayModels = await fetchGatewayModels();

        const filterGrouped = (grouped: Map<string, ModelEntry[]>) => {
          if (!filterProvider) return grouped;
          const filtered = new Map<string, ModelEntry[]>();
          for (const [provider, models] of grouped) {
            if (provider.toLowerCase() === filterProvider) {
              filtered.set(provider, models);
            }
          }
          return filtered;
        };

        if (opts.json) {
          const output: Record<string, unknown> = {};
          const jsonMapper = (m: ModelEntry) => ({
            id: m.id,
            ...(m.name ? { name: m.name } : {}),
            ...(m.description ? { description: m.description } : {}),
          });
          if (!filterType || filterType === "text") {
            output.text = Object.fromEntries(
              [...filterGrouped(groupByProvider(gatewayModels.text))].map(
                ([provider, models]) => [provider, models.map(jsonMapper)]
              )
            );
          }
          if (!filterType || filterType === "image") {
            output.image = Object.fromEntries(
              [...filterGrouped(groupByProvider(gatewayModels.image))].map(
                ([provider, models]) => [provider, models.map(jsonMapper)]
              )
            );
          }
          if (!filterType || filterType === "video") {
            output.video = Object.fromEntries(
              [...filterGrouped(groupByProvider(gatewayModels.video))].map(
                ([provider, models]) => [provider, models.map(jsonMapper)]
              )
            );
          }
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

        let totalCount = 0;
        for (const section of sections) {
          const grouped = filterGrouped(groupByProvider(section.entries));
          const count = [...grouped.values()].reduce((s, m) => s + m.length, 0);
          if (count === 0) continue;
          totalCount += count;
          process.stdout.write(`\n${section.title} models (${count}):\n`);
          for (const [provider, models] of grouped) {
            process.stdout.write(`\n  ${provider}\n`);
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
