import { fileURLToPath } from "node:url";
import mdx from "fumadocs-mdx/vite";
import { defineConfig } from "vitest/config";

import * as sourceConfig from "./source.config";

export default defineConfig({
  // Loads content/docs through the same fumadocs collection the site uses.
  plugins: [mdx(sourceConfig)],
  test: {
    server: {
      deps: {
        // These packages publish extensionless Next.js imports that need bundler resolution.
        inline: [/fumadocs-/, /@vercel\/geistdocs/],
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
