export async function readStdin(): Promise<Uint8Array | null> {
  if (process.stdin.isTTY) return null;

  const first = await Promise.race([
    new Promise<Uint8Array | null>((resolve) => {
      process.stdin.once("data", (chunk) => resolve(toBytes(chunk)));
      process.stdin.once("end", () => resolve(null));
      process.stdin.once("error", () => resolve(null));
    }),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 1000)
    ),
  ]);

  if (first === "timeout" || first === null) {
    process.stdin.destroy();
    return null;
  }

  const chunks: Uint8Array[] = [first];
  for await (const chunk of process.stdin) {
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
