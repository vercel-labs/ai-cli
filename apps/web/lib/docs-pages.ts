import { readFile } from "node:fs/promises";
import path from "node:path";

export const DOCS_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "content",
  "docs"
);

export interface DocPage {
  /** Empty for the docs index, otherwise the page path under /docs. */
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly content: string;
}

export function isSafePathSegments(segments: readonly string[]): boolean {
  return segments.every(
    (segment) =>
      segment !== ".." && !segment.includes("/") && !segment.includes("\\")
  );
}

export function docsHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

function parseDoc(name: string, raw: string): DocPage {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const fields = new Map<string, string>();
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      fields.set(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim()
      );
    }
  }
  const title = fields.get("title");
  if (!title) {
    throw new Error(`Missing title in content/docs/${name}.mdx`);
  }
  return {
    slug: name === "index" ? "" : name,
    title,
    description: fields.get("description"),
    content: raw.slice(match?.[0].length ?? 0),
  };
}

/** Page names in sidebar order, read from content/docs/meta.json. */
async function pageNames(): Promise<string[]> {
  const meta = JSON.parse(
    await readFile(path.join(DOCS_DIR, "meta.json"), "utf8")
  ) as { pages: string[] };
  return meta.pages.filter((page) => !page.startsWith("---"));
}

async function readDoc(name: string): Promise<DocPage> {
  return parseDoc(
    name,
    await readFile(path.join(DOCS_DIR, `${name}.mdx`), "utf8")
  );
}

export async function getDoc(
  segments: readonly string[]
): Promise<DocPage | null> {
  if (!isSafePathSegments(segments)) {
    return null;
  }
  const name = segments.length === 0 ? "index" : segments.join("/");
  return (await pageNames()).includes(name) ? readDoc(name) : null;
}

export async function publicDocs(): Promise<DocPage[]> {
  return Promise.all((await pageNames()).map(readDoc));
}
