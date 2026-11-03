import type { Metadata } from "next";

import { Bento } from "../components/landing/bento";
import { Features } from "../components/landing/features";
import { Hero } from "../components/landing/hero";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: {
      "text/markdown": "/index.md",
    },
  },
};

export default function Page() {
  return (
    <main className="relative isolate min-h-screen bg-[#0a0a0a] text-white selection:bg-white/20 selection:text-white">
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden md:block">
        <div className="mx-auto h-full max-w-[1320px] border-x border-x-white/[0.06]" />
      </div>
      <div className="relative z-10">
        <Hero />
        <Features />
        <Bento />
      </div>
    </main>
  );
}
