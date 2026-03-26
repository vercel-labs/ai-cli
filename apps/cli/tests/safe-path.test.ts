import { describe, expect, test } from "bun:test";

import { pathError, safePath } from "../src/utils/safe-path.js";

describe("safePath", () => {
	const cwd = process.cwd();

	test("allows relative paths within project", () => {
		expect(safePath("src/index.ts")).toBe(`${cwd}/src/index.ts`);
	});

	test("allows current directory", () => {
		expect(safePath(".")).toBe(cwd);
	});

	test("allows nested relative paths", () => {
		expect(safePath("src/utils/mask.ts")).toBe(`${cwd}/src/utils/mask.ts`);
	});

	test("rejects paths that escape project root", () => {
		expect(safePath("/etc/passwd")).toBeNull();
	});

	test("rejects parent traversal", () => {
		expect(safePath("../../../etc/passwd")).toBeNull();
	});

	test("rejects absolute paths outside project", () => {
		const home = require("node:os").homedir();
		expect(safePath(`${home}/.ssh/authorized_keys`)).toBeNull();
	});
});

describe("pathError", () => {
	test("returns descriptive error message", () => {
		const msg = pathError("/etc/passwd");
		expect(msg).toContain("outside project");
		expect(msg).toContain("/etc/passwd");
	});
});
