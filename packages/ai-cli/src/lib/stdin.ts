export async function readStdin(): Promise<Buffer | null> {
  if (process.stdin.isTTY) return null;

  const first = await Promise.race([
    new Promise<Buffer | null>((resolve) => {
      process.stdin.once("data", (chunk) => resolve(Buffer.from(chunk)));
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

  const chunks: Buffer[] = [first];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const buf = Buffer.concat(chunks);
  return buf.length > 0 ? buf : null;
}

export function stdinAsText(buf: Buffer): string {
  return buf.toString("utf-8");
}
