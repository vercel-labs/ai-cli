import {
	getReviewEnabled,
	getReviewMaxIterations,
	setReviewEnabled,
} from "../../config/settings.js";
import type { CommandHandler } from "./types.js";

export const review: CommandHandler = (_ctx, args) => {
	const arg = args?.trim().toLowerCase();

	if (arg === "on") {
		setReviewEnabled(true);
		return { output: "review loop enabled" };
	}

	if (arg === "off") {
		setReviewEnabled(false);
		return { output: "review loop disabled" };
	}

	const enabled = getReviewEnabled();
	const maxIter = getReviewMaxIterations();
	const status = enabled ? "on" : "off";
	return {
		output: `review: ${status}, max ${maxIter} iterations\nuse /review on or /review off to toggle`,
	};
};
