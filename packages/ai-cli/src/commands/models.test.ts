import { describe, expect, test } from "vitest";

import { mediaFixture } from "../test/media.js";

const fixture = mediaFixture();

describe("models discovery failure", () => {
  test.each([
    { name: "JSON output", args: ["models", "--json"] },
    { name: "table output", args: ["models"] },
  ])(
    "exits 1 with a stderr error and no stdout for $name",
    async ({ args }) => {
      const result = await fixture.run(args, { mode: "catalog-failure" });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "Error: could not fetch models from AI Gateway"
      );
    }
  );
});
