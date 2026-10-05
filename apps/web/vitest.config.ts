import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        // fromsrc publishes extensionless imports that need bundler resolution.
        inline: ["fromsrc"],
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
