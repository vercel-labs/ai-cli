import { setModel } from "../../config/index.js";
import { fetchModels, scoreMatch } from "../../utils/models.js";
import type { CommandHandler } from "./types.js";

export const model: CommandHandler = async (ctx, args) => {
	const search = args?.trim().toLowerCase();
	if (!search) {
		return {};
	}

	let allModels: { id: string }[];
	try {
		allModels = await fetchModels();
	} catch {
		return { output: "failed to fetch models" };
	}

	const scored = allModels
		.map((m) => ({ model: m, score: scoreMatch(m.id, search) }))
		.filter((x) => x.score > 0)
		.toSorted((a, b) => b.score - a.score)
		.slice(0, 10);

	if (scored.length === 0) {
		return { output: `no models matching "${search}"` };
	}

	if (scored.length === 1) {
		const newModel = scored[0].model.id;
		setModel(newModel);
		return { model: newModel, output: `switched to ${newModel}` };
	}

	const lines = [`models matching "${search}":`];
	for (const { model } of scored) {
		const prefix = model.id === ctx.model ? "› " : "  ";
		lines.push(`${prefix}${model.id}`);
	}
	lines.push("");
	lines.push(`current: ${ctx.model}`);
	lines.push("/model <name> to switch");
	return { output: lines.join("\n") };
};
