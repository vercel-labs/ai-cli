import type { Command } from "commander";

import {
  fetchGatewayModels,
  type Modality,
  type ModelEntry,
} from "../lib/models.js";

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

export function registerModelsCommand(program: Command) {
  program
    .command("models")
    .description("List available models from AI Gateway")
    .option("--type <type>", "Filter by type: text, image, video")
    .option("--creator <name>", "Filter by creator (e.g. openai, google)")
    .option("--json", "Output as JSON (includes descriptions)")
    .action(
      async (opts: { type?: string; creator?: string; json?: boolean }) => {
        const validTypes = ["text", "image", "video"];
        const filterType = opts.type?.toLowerCase() as Modality | undefined;
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
              m.capabilities.includes(filterType)
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

        let totalCount = 0;
        for (const section of sections) {
          let entries = section.entries;
          if (filterCreator) {
            entries = entries.filter(
              (m) => m.creator.toLowerCase() === filterCreator
            );
          }
          const grouped = groupByCreator(
            entries.length !== section.entries.length
              ? entries
              : section.entries
          );
          const count = [...grouped.values()].reduce(
            (s, m) => s + m.length,
            0
          );
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
