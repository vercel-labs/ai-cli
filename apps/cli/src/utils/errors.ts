import { logError } from "./errorlog.js";

type ApiError = Error & {
	statusCode?: number;
	cause?: ApiError;
	data?: { error?: { message?: string } };
	responseBody?: string;
	type?: string;
};

/**
 * Collect all error messages from the error and its cause chain
 * so gateway/provider-specific details aren't lost.
 */
function collectMessages(err: ApiError): string {
	const parts: string[] = [];
	if (err.message) {
		parts.push(err.message.toLowerCase());
	}
	if (err.data?.error?.message) {
		parts.push(err.data.error.message.toLowerCase());
	}
	let cursor: ApiError | undefined = err.cause as ApiError | undefined;
	while (cursor) {
		if (cursor.message) {
			parts.push(cursor.message.toLowerCase());
		}
		if (cursor.data?.error?.message) {
			parts.push(cursor.data.error.message.toLowerCase());
		}
		cursor = cursor.cause as ApiError | undefined;
	}
	return parts.join(" ");
}

export function formatError(error: unknown): string {
	logError(error);
	if (!(error instanceof Error)) {
		const msg = typeof error === "string" ? error : String(error);
		return msg ? `error: ${msg.slice(0, 200)}` : "error. try again";
	}
	const err = error as ApiError;
	const all = collectMessages(err);

	if (all.includes("authentication") || err.statusCode === 401) {
		return "invalid key. run: ai init";
	}
	if (
		err.statusCode === 402 ||
		all.includes("credit") ||
		all.includes("balance") ||
		all.includes("payment") ||
		all.includes("insufficient")
	) {
		return "out of credits. top up at vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai";
	}
	if (err.statusCode === 429 || all.includes("rate limit")) {
		return "rate limited. try again later";
	}

	// Model not found / not available (404, gateway routing failures)
	if (
		err.statusCode === 404 ||
		all.includes("was not found") ||
		all.includes("does not have access") ||
		all.includes("model not found")
	) {
		return "model not available. try /model to switch";
	}

	// Model doesn't support required features (tool use, streaming, etc.)
	if (
		all.includes("doesn't support") ||
		all.includes("does not support") ||
		all.includes("not supported")
	) {
		return "model does not support this feature. try /model to switch";
	}

	if (all.includes("unsupported")) {
		const match = err.message?.match(/unsupported[^:]*:\s*([^,]+)/i);
		return match ? `unsupported: ${match[1]}` : "unsupported operation";
	}
	if (err.statusCode === 400) {
		return "bad request. check your input";
	}
	if (err.statusCode === 403) {
		return "forbidden. check api key permissions";
	}
	if (
		err.statusCode === 500 ||
		err.statusCode === 502 ||
		err.statusCode === 503
	) {
		return "server error. try again later";
	}
	if (all.includes("timeout") || all.includes("timed out")) {
		return "request timed out. try again";
	}
	if (all.includes("network") || all.includes("econnrefused")) {
		return "network error. check connection";
	}
	if (all.includes("content filter") || all.includes("content_filter")) {
		return "blocked by content filter. rephrase and try again";
	}
	if (all.includes("context length") || all.includes("too long")) {
		return "message too long. try /compress or shorten your input";
	}
	if (all.includes("tool failed")) {
		return "tool failed. try again or /model to switch";
	}
	if (
		all.includes("type validation failed") ||
		err.name === "AI_TypeValidationError"
	) {
		return "provider returned unexpected data. try again or /model to switch";
	}
	const msg = err.message?.slice(0, 200);
	return msg ? `error: ${msg}` : "error. try again";
}
