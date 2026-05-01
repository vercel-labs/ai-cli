import { defineConfig } from "fromsrc";

export default defineConfig({
  title: "ai-cli",
  description: "Generate text, images, and video from the terminal.",
  docsDir: "docs",
  theme: "dark",
  sidebar: {
    defaultOpen: true,
    collapsible: true,
  },
  toc: {
    minDepth: 2,
    maxDepth: 3,
  },
});
