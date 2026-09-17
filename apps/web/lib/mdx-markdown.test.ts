import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { mdxToMarkdown } from "./mdx-markdown";

function docBody(filename: string): string {
  const source = readFileSync(
    path.join(import.meta.dir, "../docs", filename),
    "utf8"
  );
  return source.replace(/^---\n[\s\S]*?\n---\n/, "");
}

describe("mdxToMarkdown", () => {
  test("converts component semantics to plain Markdown", () => {
    const output = mdxToMarkdown(`
<Cards>
  <Card title="Image generation" description="Create images." href="/images" />
</Cards>

<Properties>
  <Property name="--count" type="number" default="1" required deprecated>
    Number of results.
  </Property>
</Properties>

<Steps>
  <Step>
    ### Install

    \`\`\`bash
    bun add ai-cli
    \`\`\`
  </Step>
</Steps>

<Callout type="warning" title="Check this">
  Keep the API key private.
</Callout>
`);

    expect(output).toContain(
      "- [**Image generation**](/images): Create images."
    );
    expect(output).toContain("#### `--count`");
    expect(output).toContain(
      "Type: `number` | Default: `1` | Required | Deprecated"
    );
    expect(output).toContain("Number of results.");
    expect(output).toContain("1. **Install**");
    expect(output).toContain("```bash");
    expect(output).toContain("> **Warning: Check this**:");
    expect(output).toContain("> Keep the API key private.");
    expect(output).not.toMatch(
      /<(Cards|Card|Properties|Property|Steps|Step|Callout)/
    );
  });

  test("preserves ordinary GFM and fenced code", () => {
    const output = mdxToMarkdown(`
## Table

| Name | Value |
| --- | --- |
| alpha | one |

\`\`\`ts
const value = 1;
\`\`\`
`);

    expect(output).toContain("| Name  | Value |");
    expect(output).toContain("```ts");
    expect(output).toContain("const value = 1;");
  });

  test("fails on unsupported components", () => {
    expect(() => mdxToMarkdown('<Unknown value="x" />')).toThrow(
      "Unsupported MDX component: Unknown"
    );
    expect(() => mdxToMarkdown("<Callout type>\n  Text\n</Callout>")).toThrow(
      "Callout type must be a string"
    );
    expect(() => mdxToMarkdown("Text <Unknown />")).toThrow(
      "Unsupported MDX node: mdxJsxTextElement"
    );
  });

  test("serializes every current documentation source without JSX", () => {
    const filenames = readdirSync(path.join(import.meta.dir, "../docs"))
      .filter((filename) => filename.endsWith(".mdx"))
      .toSorted();

    expect(filenames).toContain("evaluate.mdx");
    for (const filename of filenames) {
      const output = mdxToMarkdown(docBody(filename));
      expect(output, filename).not.toMatch(/<[A-Z][A-Za-z]*/);
    }
  });
});
