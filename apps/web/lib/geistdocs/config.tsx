import { defineConfig } from "@vercel/geistdocs/config";

import { siteName, siteUrl } from "@/lib/site";

function Logo() {
  return (
    <span className="text-sm font-semibold tracking-tight">{siteName}</span>
  );
}

export const config = defineConfig({
  title: siteName,
  siteUrl,
  defaultLanguage: "en",
  logo: <Logo />,
  navbarActiveProduct: siteName,
  navbarBrand: "labs",
  github: {
    owner: "vercel-labs",
    repo: "ai-cli",
    branch: "main",
    editPath: "apps/web/content/docs",
  },
  content: [
    { id: "docs", label: "Documentation", dir: "content/docs", route: "/docs" },
  ],
  nav: [
    { label: "Docs", href: "/docs" },
    { label: "npm", href: "https://www.npmjs.com/package/ai-cli", external: true },
  ],
  ai: { enabled: false },
  feedback: { enabled: false },
  language: { enabled: false },
  pageActions: { askAI: false, openInChat: false },
  webmcp: { enabled: true },
});
