import { describe, expect, test } from "bun:test";

import { createStreamWrap, wrap } from "../src/utils/wrap.js";

describe("wrap", () => {
	test("returns short text unchanged", () => {
		expect(wrap("hello", 80)).toBe("hello");
	});

	test("wraps long lines at word boundaries", () => {
		const text = "one two three four five";
		expect(wrap(text, 10)).toBe("one two\nthree\nfour five");
	});

	test("preserves existing newlines", () => {
		expect(wrap("line1\nline2", 80)).toBe("line1\nline2");
	});

	test("handles single long word", () => {
		expect(wrap("superlongword", 5)).toBe("superlongword");
	});

	test("handles empty string", () => {
		expect(wrap("", 80)).toBe("");
	});

	test("handles multiple spaces", () => {
		const text = "hello world";
		const result = wrap(text, 80);
		expect(result).toContain("hello");
		expect(result).toContain("world");
	});
});

describe("createStreamWrap", () => {
	test("buffers text until space", () => {
		const sw = createStreamWrap();
		expect(sw.write("hello")).toBe("");
		expect(sw.write(" ")).toBe("hello ");
	});

	test("flushes remaining buffer", () => {
		const sw = createStreamWrap();
		sw.write("hello");
		expect(sw.flush()).toBe("hello");
	});

	test("handles newlines", () => {
		const sw = createStreamWrap();
		sw.write("hello");
		expect(sw.write("\n")).toBe("hello\n");
	});

	test("reset clears buffer", () => {
		const sw = createStreamWrap();
		sw.write("hello");
		sw.reset();
		expect(sw.flush()).toBe("");
	});
});
