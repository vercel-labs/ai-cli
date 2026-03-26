import { dim, gray } from "../utils/color.js";
import { fetchModels } from "../utils/models.js";
import type { Model } from "../utils/models.js";
import { createSpinner } from "../utils/spinner.js";

export async function listModels(): Promise<void> {
	const spinner = createSpinner();
	spinner.start("fetching models...");

	try {
		const models = await fetchModels();
		spinner.stop();

		const grouped = new Map<string, Model[]>();

		for (const model of models) {
			const provider = model.id.split("/")[0] ?? "unknown";
			const existing = grouped.get(provider) ?? [];
			existing.push(model);
			grouped.set(provider, existing);
		}

		console.log(gray("available models:\n"));

		for (const [provider, providerModels] of grouped) {
			console.log(dim(`  ${provider}`));
			for (const model of providerModels) {
				console.log(`    ${model.id}`);
			}
			console.log();
		}

		console.log(dim('usage: ai -m <model> "message"'));
	} catch {
		spinner.stop();
		console.error("failed to fetch models");
		process.exit(1);
	}
}
