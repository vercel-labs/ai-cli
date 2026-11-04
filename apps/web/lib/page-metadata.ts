import type { Metadata } from "next";

import { docsHref, getDoc } from "./docs-pages";
import { description as siteDescription, siteName } from "./site";

function metaDescription(text: string | undefined): string {
  if (text && text.length >= 50) {
    return text;
  }
  if (!text) {
    return siteDescription;
  }
  const combined = `${text} ${siteDescription}`;
  return combined.length >= 50 ? combined : siteDescription;
}

export async function pageMetadata(
  segments: readonly string[]
): Promise<Metadata> {
  const doc = await getDoc(segments);
  if (!doc) {
    return {};
  }
  const href = docsHref(doc.slug);
  const description = metaDescription(doc.description);
  return {
    title: doc.title,
    description,
    alternates: {
      canonical: href,
      types: { "text/markdown": `${href}.md` },
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName,
      title: doc.title,
      description,
      url: href,
      images: [{ url: "/og", width: 1200, height: 630, alt: doc.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: doc.title,
      description,
      images: ["/og"],
    },
  };
}
