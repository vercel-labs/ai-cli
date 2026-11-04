import { createSource } from "@vercel/geistdocs/source";

import { docs } from "@/.source/server";
import { markdownForPathname } from "@/lib/page-markdown";

import { config } from "./config";

export const geistdocsSource = createSource({
  docs,
  config,
  baseUrl: "/docs",
  markdown: {
    transform: async (_markdown, { page }) => {
      const pathname = `/docs${page.slugs.length > 0 ? `/${page.slugs.join("/")}` : ""}`;
      return (await markdownForPathname(pathname, ["docs", ...page.slugs]))
        .body;
    },
  },
});
