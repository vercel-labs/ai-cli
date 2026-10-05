import { describe, expect, test } from "vitest";

import { shouldServeMarkdown } from "@vercel/agent-readability";

describe("agent readability", () => {
	test.each([
		"Slackbot-LinkExpanding 1.0",
		"Discordbot/2.0",
		"redditbot/1.0",
		"bitlybot/3.0",
		"Pinterestbot/1.0",
	])("keeps %s on HTML", (userAgent) => {
		const result = shouldServeMarkdown({
			headers: new Headers({ "user-agent": userAgent }),
		});

		expect(result.serve).toBe(false);
	});

	test("still detects agents", () => {
		const result = shouldServeMarkdown({
			headers: new Headers({ "user-agent": "ClaudeBot/1.0" }),
		});

		expect(result.serve).toBe(true);
	});
});
