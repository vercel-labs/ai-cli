"use client";

import { GeistdocsProvider } from "@vercel/geistdocs/layout";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { config } from "@/lib/geistdocs/config";

/**
 * The landing page is dark only, so the site forces the dark theme.
 * GeistdocsProvider ignores its `theme` prop and nests its own next-themes
 * provider, which defers to this outer one. The class names and storage key
 * match the ones geistdocs uses.
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      forcedTheme="dark"
      storageKey="geistdocs-theme"
      value={{ dark: "dark-theme", light: "light-theme" }}
    >
      <GeistdocsProvider config={config} lang="en">
        {children}
      </GeistdocsProvider>
    </ThemeProvider>
  );
}
