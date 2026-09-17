import { describe, expect, test } from "bun:test";

import {
  decodeRecordText,
  formatRecords,
  parseInputFormat,
  parseRecords,
} from "./records.js";

describe("record input/output", () => {
  test("preserves line contents, duplicates, and input indices", () => {
    const input = parseRecords("  alpha  \r\n\r\nbeta\r\n  alpha  \r\n");
    expect(input.format).toBe("lines");
    expect(input.records.map((record) => record.index)).toEqual([1, 2, 3]);
    expect(
      formatRecords([input.records[2], input.records[0]], input.format)
    ).toBe("  alpha  \n  alpha  \n");
  });

  test("JSON arrays remain collections through repeated selections", () => {
    const input = parseRecords(
      '[{"id":1,"nested":["a"]},{"id":2,"text":"two\\nlines"},null]'
    );
    expect(input.format).toBe("json");
    const output = formatRecords([input.records[1]], input.format);
    expect(JSON.parse(output)).toEqual([{ id: 2, text: "two\nlines" }]);
    expect(parseRecords(output).records[0].value).toEqual(
      input.records[1].value
    );
    expect(formatRecords([], input.format)).toBe("[]\n");
  });

  test("JSONL preserves the selected source line", () => {
    const input = parseRecords(' { "id": 1 }\n{"id":2}\n', "jsonl");
    expect(formatRecords([input.records[0]], input.format)).toBe(
      ' { "id": 1 }\n'
    );
    expect(parseRecords('{"id":1}\n{"id":2}').format).toBe("jsonl");
  });

  test("explicit JSONL preserves array-valued records", () => {
    expect(parseRecords('["a","b"]\n', "jsonl").records).toHaveLength(1);
    expect(parseRecords('["a","b"]\n', "json").records).toHaveLength(2);
  });

  test("empty input needs no model evaluation", () => {
    expect(parseRecords("").records).toEqual([]);
    expect(parseRecords("[]").records).toEqual([]);
    expect(parseRecords(" \n", "jsonl").records).toEqual([]);
  });

  test("malformed structured input fails rather than becoming plain text", () => {
    expect(() => parseRecords('[{"id":1}')).toThrow("Invalid JSON");
    expect(() => parseRecords('{"id":1}\n{bad}', "jsonl")).toThrow("line 2");
    expect(() => parseRecords("not json", "json")).toThrow("Invalid JSON");
    expect(parseRecords("[INFO] ready\n", "lines").records[0].value).toBe(
      "[INFO] ready"
    );
  });

  test("rejects unknown formats and binary input", () => {
    expect(() => parseInputFormat("yaml")).toThrow("--input");
    expect(() => decodeRecordText(new Uint8Array([0xff, 0xfe]))).toThrow(
      "UTF-8"
    );
  });
});
