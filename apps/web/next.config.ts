import { createGeistdocs } from "@vercel/geistdocs/next";
import type { NextConfig } from "next";

const withGeistdocs = createGeistdocs();

const config: NextConfig = {
  reactCompiler: true,
  skipProxyUrlNormalize: true,
  outputFileTracingIncludes: {
    "/*": ["./content/docs/**/*"],
  },
  async headers() {
    return process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
      ? [
          {
            source: "/:path*",
            headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
          },
        ]
      : [];
  },
  async redirects() {
    return [
      {
        source: "/docs/evaluate",
        destination: "/docs/decide",
        permanent: true,
      },
      {
        source: "/docs/evaluate.md",
        destination: "/docs/decide.md",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/index.md", destination: "/api/docs-md" },
        { source: "/:path*.md", destination: "/api/docs-md/:path*" },
      ],
    };
  },
};

export default withGeistdocs(config);
