import { describe, expect, test } from "bun:test";

import { formatError } from "../src/utils/errors.js";

describe("formatError", () => {
	test("handles authentication errors", () => {
		const error = new Error("Authentication failed");
		expect(formatError(error)).toBe("invalid key. run: ai init");
	});

	test("handles 401 status", () => {
		const error = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
		expect(formatError(error)).toBe("invalid key. run: ai init");
	});

	test("handles credit/balance errors", () => {
		const error = new Error("Insufficient credits");
		expect(formatError(error)).toContain("out of credits");
	});

	test("handles 402 status", () => {
		const error = Object.assign(new Error("Payment required"), {
			statusCode: 402,
		});
		expect(formatError(error)).toContain("out of credits");
	});

	test("handles rate limit errors", () => {
		const error = new Error("Rate limit exceeded");
		expect(formatError(error)).toBe("rate limited. try again later");
	});

	test("handles 429 status", () => {
		const error = Object.assign(new Error("Too many requests"), {
			statusCode: 429,
		});
		expect(formatError(error)).toBe("rate limited. try again later");
	});

	test("handles unsupported errors", () => {
		const error = new Error("Unsupported operation: vision");
		expect(formatError(error)).toContain("unsupported");
	});

	test("handles 400 status", () => {
		const error = Object.assign(new Error("Bad request"), { statusCode: 400 });
		expect(formatError(error)).toBe("bad request. check your input");
	});

	test("handles 403 status", () => {
		const error = Object.assign(new Error("Forbidden"), { statusCode: 403 });
		expect(formatError(error)).toBe("forbidden. check api key permissions");
	});

	test("handles server errors", () => {
		const error = Object.assign(new Error("Internal server error"), {
			statusCode: 500,
		});
		expect(formatError(error)).toBe("server error. try again later");
	});

	test("handles timeout errors", () => {
		const error = new Error("Request timed out");
		expect(formatError(error)).toBe("request timed out. try again");
	});

	test("handles network errors", () => {
		const error = new Error("Network error");
		expect(formatError(error)).toBe("network error. check connection");
	});

	test("handles tool failed errors", () => {
		const error = new Error("tool failed: readFile");
		expect(formatError(error)).toBe(
			"tool failed. try again or /model to switch",
		);
	});

	test("handles type validation errors by message", () => {
		const error = new Error("Type validation failed: Value: {}");
		expect(formatError(error)).toBe(
			"provider returned unexpected data. try again or /model to switch",
		);
	});

	test("handles type validation errors by name", () => {
		const error = Object.assign(new Error(""), {
			name: "AI_TypeValidationError",
		});
		expect(formatError(error)).toBe(
			"provider returned unexpected data. try again or /model to switch",
		);
	});

	test("handles unknown errors with message", () => {
		const error = new Error("Something weird happened");
		expect(formatError(error)).toBe("error: Something weird happened");
	});

	test("handles unknown errors without message", () => {
		const error = new Error();
		expect(formatError(error)).toBe("error. try again");
	});

	test("handles error with cause", () => {
		const cause = new Error("Unsupported feature");
		const error = Object.assign(new Error("Failed"), { cause });
		expect(formatError(error)).toContain("unsupported");
	});
});
