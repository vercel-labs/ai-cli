import type { NextConfig } from "next";

const config: NextConfig = {
  reactCompiler: true,
  outputFileTracingIncludes: {
    "/*": ["./docs/**/*"],
  },
};

export default config;
