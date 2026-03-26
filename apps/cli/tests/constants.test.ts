import { describe, expect, test } from "bun:test";

import { AI_CLI_HEADERS } from "../src/utils/constants.js";

describe("AI_CLI_HEADERS", () => {
	test("contains HTTP-Referer", () => {
		expect(AI_CLI_HEADERS["HTTP-Referer"]).toBe(
			"https://www.npmjs.com/package/ai-cli",
		);
	});

	test("contains X-Title", () => {
		expect(AI_CLI_HEADERS["X-Title"]).toBe("ai-cli");
	});
});
