import { getConfig, setConfig } from "./index.js";
import type { Config } from "./index.js";

export type Settings = Pick<
	Config,
	"spacing" | "markdown" | "model" | "search"
>;

let cached: Settings | null = null;

export function loadSettings(): Settings {
	if (cached) {
		return cached;
	}
	const config = getConfig();
	cached = {
		spacing: config.spacing ?? 1,
		markdown: config.markdown ?? true,
		model: config.model ?? "",
		search: config.search ?? "perplexity",
	};
	return cached;
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
	return loadSettings()[key];
}

export function setSetting<K extends keyof Settings>(
	key: K,
	value: Settings[K],
): void {
	setConfig({ [key]: value });
	cached = null;
}

export function invalidateSettingsCache(): void {
	cached = null;
}

export function getReviewEnabled(): boolean {
	const config = getConfig();
	return config.review?.enabled ?? true;
}

export function setReviewEnabled(enabled: boolean): void {
	const config = getConfig();
	setConfig({ review: { ...config.review, enabled } });
	cached = null;
}

export function getReviewMaxIterations(): number {
	const config = getConfig();
	return config.review?.maxIterations ?? 3;
}
