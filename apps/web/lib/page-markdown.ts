import { generateNotFoundMarkdown } from "@vercel/agent-readability";
import { getDoc } from "fromsrc";

import {
  DOCS_DIR,
  docsHref,
  isSafePathSegments,
  publicDocs,
} from "./docs-pages";
import { mdxToMarkdown } from "./mdx-markdown";
import { canonicalUrlFor, description, siteName, siteUrl } from "./site";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(fields: {
  title: string;
  description: string;
  canonicalUrl: string;
}): string {
  return [
    "---",
    `title: ${yamlString(fields.title)}`,
    `description: ${yamlString(fields.description)}`,
    `canonical_url: ${yamlString(fields.canonicalUrl)}`,
    "---",
    "",
  ].join("\n");
}

async function documentationLinks(): Promise<string> {
  const docs = await publicDocs();
  return docs
    .map((doc) => `- [${doc.title}](${siteUrl}${docsHref(doc.slug)})`)
    .join("\n");
}

async function homeMarkdown(): Promise<string> {
  const canonicalUrl = canonicalUrlFor("/");
  const docsLinks = await documentationLinks();
  return `${frontmatter({
    title: siteName,
    description,
    canonicalUrl,
  })}# ${siteName}

${description}

## Install

\`\`\`bash
npm install -g ai-cli
\`\`\`

## Commands

- \`ai image "prompt"\`
- \`ai video "prompt"\`
- \`ai text "prompt"\`
- \`ai audio speak "text"\`
- \`ai decide --boolean "refund=Refund requested?" < ticket.txt\`
- \`ai models\`

## Documentation

${docsLinks}
`;
}

async function sitemapMarkdown(): Promise<string> {
  const docsLinks = await documentationLinks();
  return `# ${siteName}

- [Home](${siteUrl})
${docsLinks}
`;
}

export async function markdownForPathname(
  pathname: string,
  decodedSegments: readonly string[]
): Promise<{
  body: string;
  canonicalUrl: string;
  found: boolean;
}> {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname || "/";

  if (normalized === "/") {
    return {
      body: await homeMarkdown(),
      canonicalUrl: canonicalUrlFor("/"),
      found: true,
    };
  }

  if (normalized === "/sitemap") {
    return {
      body: await sitemapMarkdown(),
      canonicalUrl: `${siteUrl}/sitemap.md`,
      found: true,
    };
  }

  if (normalized === "/docs" || normalized.startsWith("/docs/")) {
    const slug =
      normalized === "/docs"
        ? []
        : normalized.slice("/docs/".length).split("/");
    const safe =
      isSafePathSegments(slug) && isSafePathSegments(decodedSegments);
    const doc = safe ? await getDoc(DOCS_DIR, slug) : null;
    if (doc) {
      const href = docsHref(doc.slug === "index" ? "" : doc.slug);
      const canonicalUrl = canonicalUrlFor(href);
      const heading = `# ${doc.title}`;
      const body = `${frontmatter({
        title: doc.title,
        description: doc.description ?? description,
        canonicalUrl,
      })}${heading}

${mdxToMarkdown(doc.content)}
`;
      return { body, canonicalUrl, found: true };
    }
  }

  const docs = await publicDocs();
  const example = docs[1] ? docsHref(docs[1].slug) : "/docs/installation";
  return {
    body: generateNotFoundMarkdown(normalized, {
      sitemapUrl: "/sitemap.md",
      indexUrl: "/llms.txt",
      exampleUrl: example,
      baseUrl: siteUrl,
    }),
    canonicalUrl: canonicalUrlFor(normalized),
    found: false,
  };
}
