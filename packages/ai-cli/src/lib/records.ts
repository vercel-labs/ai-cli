import type { JSONValue } from "ai";

export type RecordFormat = "lines" | "json" | "jsonl";
export type InputFormat = "auto" | RecordFormat;

export interface InputRecord {
  index: number;
  value: JSONValue;
  raw: string;
}

export interface RecordInput {
  format: RecordFormat;
  records: InputRecord[];
}

export function parseInputFormat(value = "auto"): InputFormat {
  if (!["auto", "lines", "json", "jsonl"].includes(value)) {
    throw new Error("--input must be one of: auto, lines, json, jsonl");
  }
  return value as InputFormat;
}

function parseJson(text: string, description: string): JSONValue {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    throw new Error(
      "Invalid JSON in " + description + ". Use --input lines for plain text."
    );
  }
}

export function parseRecords(
  text: string,
  input: InputFormat = "auto"
): RecordInput {
  const trimmed = text.trim();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let format: RecordFormat;
  let values: JSONValue[] | undefined;

  if (input === "auto") {
    if (!trimmed) return { format: "lines", records: [] };
    try {
      const value = JSON.parse(trimmed) as JSONValue;
      values = Array.isArray(value) ? value : [value];
      format = "json";
    } catch {
      try {
        values = lines.map((line) => JSON.parse(line) as JSONValue);
        format = "jsonl";
      } catch {
        // JSON-looking input should fail visibly instead of being evaluated as
        // unrelated text fragments. --input lines disambiguates bracketed logs.
        if (/^[{["]/.test(trimmed)) {
          throw new Error(
            "Invalid JSON input. Use --input lines for plain text."
          );
        }
        format = "lines";
      }
    }
  } else {
    format = input;
  }

  if (!trimmed) return { format, records: [] };
  if (!values && format === "json") {
    const value = parseJson(trimmed, "stdin");
    values = Array.isArray(value) ? value : [value];
  }
  if (!values && format === "jsonl") {
    values = lines.map((line, index) => parseJson(line, "line " + (index + 1)));
  }
  if (!values) values = lines;

  return {
    format,
    records: values.map((value, index) => ({
      index: index + 1,
      value,
      raw: format === "json" ? JSON.stringify(value) : lines[index],
    })),
  };
}

export function formatRecords(
  records: InputRecord[],
  format: RecordFormat
): string {
  if (format === "json") {
    return (
      JSON.stringify(
        records.map((record) => record.value),
        null,
        2
      ) + "\n"
    );
  }
  return records.map((record) => record.raw + "\n").join("");
}

export function decodeRecordText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Record input must be UTF-8 text, not binary data.");
  }
}
