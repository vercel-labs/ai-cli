import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Node } from "fumadocs-core/page-tree";

import { geistdocsSource } from "./geistdocs/source";

const DOCS_DIR = path.join(
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

type SourcePage = NonNullable<
  ReturnType<typeof geistdocsSource.source.getPage>
>;

export function isSafePathSegments(segments: readonly string[]): boolean {
  return segments.every(
    (segment) =>
      segment !== ".." && !segment.includes("/") && !segment.includes("\\")
  );
}

export function docsHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

/** Page list and metadata come from fumadocs; the MDX body comes from the page's file. */
async function toDoc(page: SourcePage): Promise<DocPage> {
  const { title } = page.data;
  if (!title) {
    throw new Error(`Missing title in content/docs/${page.path}`);
  }
  const raw = await readFile(path.join(DOCS_DIR, page.path), "utf8");
  return {
    slug: page.slugs.join("/"),
    title,
    description: page.data.description,
    content: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""),
  };
}

function pageUrls(nodes: readonly Node[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "page") {
      return [node.url];
    }
    if (node.type === "folder") {
      return [
        ...(node.index ? [node.index.url] : []),
        ...pageUrls(node.children),
      ];
    }
    return [];
  });
}

export async function getDoc(
  segments: readonly string[]
): Promise<DocPage | null> {
  if (!isSafePathSegments(segments)) {
    return null;
  }
  // `/docs/index.md` names the docs index, which fumadocs stores under no slug.
  const slugs = segments.length === 1 && segments[0] === "index" ? [] : segments;
  const page = geistdocsSource.source.getPage([...slugs], "en");
  return page ? toDoc(page) : null;
}

/** Every docs page in sidebar order, followed by pages the sidebar omits. */
export async function publicDocs(): Promise<DocPage[]> {
  const { source } = geistdocsSource;
  const pages = source.getPages("en");
  const order = pageUrls(source.getPageTree("en").children);
  const rank = (url: string) => {
    const index = order.indexOf(url);
    return index === -1 ? order.length : index;
  };
  return Promise.all(
    pages.toSorted((a, b) => rank(a.url) - rank(b.url)).map(toDoc)
  );
}
