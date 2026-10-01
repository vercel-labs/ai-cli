import type { NextConfig } from "next";

const config: NextConfig = {
  reactCompiler: true,
  outputFileTracingIncludes: {
    "/*": ["./docs/**/*"],
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

export default config;
