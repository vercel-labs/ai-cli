import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./docs/**/*"],
  },
};

export default config;
