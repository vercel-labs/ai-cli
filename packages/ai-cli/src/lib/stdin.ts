import type { Readable } from "node:stream";

export async function readStdin(
  input: Readable & { isTTY?: boolean } = process.stdin
): Promise<Uint8Array | null> {
  if (input.isTTY) return null;

  // A preceding evaluation or generation command may take several seconds
  // before producing its first byte. EOF, not a timer, terminates a pipe.
  const chunks: Uint8Array[] = [];
  for await (const chunk of input) {
    chunks.push(toBytes(chunk));
  }

  const buf = Buffer.concat(chunks);
  return buf.length > 0 ? new Uint8Array(buf) : null;
}

export function stdinAsText(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

function toBytes(chunk: unknown): Uint8Array {
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  return new TextEncoder().encode(String(chunk));
}
