import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ai-cli",
  description: "Generate text, images, and video from the terminal.",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "ai-cli",
    title: "ai-cli",
    description: "Generate text, images, and video from the terminal.",
    images: [{ url: "/og", width: 1200, height: 630, alt: "ai-cli" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ai-cli",
    description: "Generate text, images, and video from the terminal.",
    images: ["/og"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body
        className="font-sans antialiased bg-[#0a0a0a] text-white"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
