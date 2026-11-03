import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
