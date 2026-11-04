import type {
  BlockContent,
  Blockquote,
  DefinitionContent,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Text,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

type MdxElement = Extract<
  RootContent,
  { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }
>;

function text(value: string): Text {
  return { type: "text", value };
}

function strong(value: string): Strong {
  return { type: "strong", children: [text(value)] };
}

function paragraph(children: PhrasingContent[]): Paragraph {
  return { type: "paragraph", children };
}

function inlineCode(value: string): PhrasingContent {
  return { type: "inlineCode", value };
}

function attribute(node: MdxElement, name: string): string | undefined {
  const value = node.attributes.find(
    (item) => item.type === "mdxJsxAttribute" && item.name === name
  );
  if (!value || value.type !== "mdxJsxAttribute") {
    return;
  }
  if (value.value === null || value.value === undefined) {
    return "";
  }
  if (typeof value.value !== "string") {
    throw new TypeError(
      `Unsupported expression in ${node.name ?? "fragment"} attribute ${name}`
    );
  }
  return value.value;
}

function hasAttribute(node: MdxElement, name: string): boolean {
  return node.attributes.some(
    (item) => item.type === "mdxJsxAttribute" && item.name === name
  );
}

function cardItem(node: MdxElement): ListItem {
  const title = attribute(node, "title");
  if (!title) {
    throw new Error("Card requires a title");
  }
  const description = attribute(node, "description");
  const href = attribute(node, "href");
  const titleContent: PhrasingContent = href
    ? { type: "link", url: href, children: [strong(title)] }
    : strong(title);
  const children: PhrasingContent[] = [titleContent];
  if (description) {
    children.push(text(`: ${description}`));
  }
  return { type: "listItem", children: [paragraph(children)] };
}

function propertyNodes(node: MdxElement): RootContent[] {
  const name = attribute(node, "name");
  if (!name) {
    throw new Error("Property requires a name");
  }
  const type = attribute(node, "type");
  const defaultValue = attribute(node, "default");
  const details: PhrasingContent[] = [];
  if (type) {
    details.push(text("Type: "), inlineCode(type));
  }
  if (defaultValue !== undefined) {
    if (details.length > 0) {
      details.push(text(" | "));
    }
    details.push(text("Default: "), inlineCode(defaultValue));
  }
  if (hasAttribute(node, "required")) {
    if (details.length > 0) {
      details.push(text(" | "));
    }
    details.push(text("Required"));
  }
  if (hasAttribute(node, "deprecated")) {
    if (details.length > 0) {
      details.push(text(" | "));
    }
    details.push(text("Deprecated"));
  }
  const heading: Heading = {
    type: "heading",
    depth: 4,
    children: [{ type: "inlineCode", value: name }],
  };
  const result: RootContent[] = [heading];
  if (details.length > 0) {
    result.push(paragraph(details));
  }
  return [...result, ...transformNodes(node.children)];
}

function stepItem(node: MdxElement): ListItem {
  const children = blockNodes(node.children);
  const first = children[0];
  if (first?.type === "heading") {
    children[0] = paragraph([
      {
        type: "strong",
        children: first.children,
      },
    ]);
  }
  return { type: "listItem", spread: true, children };
}

function callout(node: MdxElement): Blockquote {
  const type = attribute(node, "type") ?? "info";
  const title = attribute(node, "title");
  if (!type) {
    throw new Error("Callout type must be a string");
  }
  const label = title ? `${type}: ${title}` : type;
  return {
    type: "blockquote",
    children: [
      paragraph([strong(label[0].toUpperCase() + label.slice(1)), text(":")]),
      ...blockNodes(node.children),
    ],
  };
}

function transformElement(node: MdxElement): RootContent[] {
  switch (node.name) {
    case "Cards": {
      const items = node.children.map((child) => {
        if (child.type !== "mdxJsxFlowElement" || child.name !== "Card") {
          throw new Error("Cards may only contain Card elements");
        }
        return cardItem(child);
      });
      const list: List = { type: "list", ordered: false, children: items };
      return [list];
    }
    case "Properties": {
      return transformNodes(node.children);
    }
    case "Steps": {
      const items = node.children.map((child) => {
        if (child.type !== "mdxJsxFlowElement" || child.name !== "Step") {
          throw new Error("Steps may only contain Step elements");
        }
        return stepItem(child);
      });
      const list: List = { type: "list", ordered: true, children: items };
      return [list];
    }
    case "Card": {
      return [cardItem(node)];
    }
    case "Property": {
      return propertyNodes(node);
    }
    case "Step": {
      return [stepItem(node)];
    }
    case "Callout": {
      return [callout(node)];
    }
    default: {
      throw new Error(`Unsupported MDX component: ${node.name ?? "fragment"}`);
    }
  }
}

function blockNodes(
  nodes: RootContent[]
): Array<BlockContent | DefinitionContent> {
  const children = transformNodes(nodes);
  for (const child of children) {
    switch (child.type) {
      case "blockquote":
      case "code":
      case "definition":
      case "footnoteDefinition":
      case "heading":
      case "html":
      case "list":
      case "paragraph":
      case "table":
      case "thematicBreak": {
        break;
      }
      default: {
        throw new Error(`Unsupported block content: ${child.type}`);
      }
    }
  }
  return children as Array<BlockContent | DefinitionContent>;
}

function transformNodes(nodes: RootContent[]): RootContent[] {
  const result: RootContent[] = [];
  for (const node of nodes) {
    if (
      node.type === "mdxJsxFlowElement" ||
      node.type === "mdxJsxTextElement"
    ) {
      result.push(...transformElement(node));
    } else {
      result.push(node);
    }
  }
  return result;
}

function assertNoMdx(node: {
  type: string;
  children?: Array<{ type: string; children?: unknown[] }>;
}): void {
  if (node.type.startsWith("mdx")) {
    throw new Error(`Unsupported MDX node: ${node.type}`);
  }
  for (const child of node.children ?? []) {
    assertNoMdx(child as { type: string; children?: Array<{ type: string }> });
  }
}

/** Removes fumadocs custom heading ids (`## Title [#id]`), which only apply to HTML. */
function stripHeadingIds(nodes: RootContent[]): void {
  for (const node of nodes) {
    if (node.type === "heading") {
      const last = node.children.at(-1);
      if (last?.type === "text") {
        last.value = last.value.replace(/\s*\[#[\w-]+\]$/, "");
      }
    } else if ("children" in node) {
      stripHeadingIds(node.children as RootContent[]);
    }
  }
}

export function mdxToMarkdown(source: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkStringify, { bullet: "-", fences: true });
  const tree = processor.parse(source) as Root;
  tree.children = transformNodes(tree.children);
  stripHeadingIds(tree.children);
  assertNoMdx(tree);
  return processor.stringify(tree).trim();
}
