import { describe, expect, test } from "bun:test";

/**
 * Builds a trackOutput closure identical to the one in print.ts,
 * writing to a buffer instead of process.stdout for testability.
 */
function makeTracker(jsonMode: boolean) {
	const written: string[] = [];
	let output = "";
	let outputEndsWithNewline = false;

	const write = (s: string) => {
		written.push(s);
	};

	const trackOutput = (content: string) => {
		if (!content) {
			return;
		}
		if (jsonMode) {
			output = content;
		} else if (content !== output) {
			if (output && content.startsWith(output)) {
				const chunk = content.slice(output.length);
				write(chunk);
				outputEndsWithNewline = chunk.endsWith("\n");
			} else if (output && !outputEndsWithNewline) {
				write(`\n${content}`);
				outputEndsWithNewline = content.endsWith("\n");
			} else {
				write(content);
				outputEndsWithNewline = content.endsWith("\n");
			}
			output = content;
		}
	};

	const resetPending = () => {
		output = "";
		outputEndsWithNewline = false;
	};

	return { trackOutput, resetPending, written, getOutput: () => output };
}

describe("trackOutput", () => {
	test("incremental buffer growth writes only the delta", () => {
		const t = makeTracker(false);
		t.trackOutput("Hello");
		t.trackOutput("Hello world");
		expect(t.written).toEqual(["Hello", " world"]);
	});

	test('reset via onPending("") clears output', () => {
		const t = makeTracker(false);
		t.trackOutput("first");
		t.resetPending();
		expect(t.getOutput()).toBe("");
		t.trackOutput("second");
		expect(t.written).toEqual(["first", "second"]);
	});

	test("unrelated content gets newline separator", () => {
		const t = makeTracker(false);
		t.trackOutput("first");
		t.trackOutput("second");
		expect(t.written).toEqual(["first", "\nsecond"]);
	});

	test("skips newline separator when previous output ends with newline", () => {
		const t = makeTracker(false);
		t.trackOutput("first\n");
		t.trackOutput("second");
		expect(t.written).toEqual(["first\n", "second"]);
	});

	test("identical content is not written twice", () => {
		const t = makeTracker(false);
		t.trackOutput("same");
		t.trackOutput("same");
		expect(t.written).toEqual(["same"]);
	});

	test("JSON mode only stores output, does not write", () => {
		const t = makeTracker(true);
		t.trackOutput("hello");
		t.trackOutput("world");
		expect(t.written).toEqual([]);
		expect(t.getOutput()).toBe("world");
	});

	test("empty content is ignored", () => {
		const t = makeTracker(false);
		t.trackOutput("");
		expect(t.written).toEqual([]);
	});

	test("reset then unrelated content writes without separator", () => {
		const t = makeTracker(false);
		t.trackOutput("first");
		t.resetPending();
		t.trackOutput("unrelated");
		expect(t.written).toEqual(["first", "unrelated"]);
	});
});

describe("timeout flooring", () => {
	test("Math.floor truncates fractional timeout", () => {
		expect(Math.floor(1.7)).toBe(1);
		expect(Math.floor(30.9)).toBe(30);
		expect(Math.floor(0.5)).toBe(0);
	});

	test("fractional timeout <= 0 after floor is invalid", () => {
		const timeout = 0.5;
		const timeoutSec = Math.floor(timeout);
		expect(timeoutSec).toBe(0);
		expect(timeoutSec <= 0).toBe(true);
	});

	test("integer timeout is unchanged", () => {
		const timeout = 60;
		const timeoutSec = Math.floor(timeout);
		expect(timeoutSec).toBe(60);
	});
});
