"use client";

import { Stage } from "./stage";
import { Terminal } from "./terminal";
import { Window } from "./window";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-0 md:pt-44 md:pb-0">
      <div className="mx-auto max-w-[1320px] px-6">
        <div className="max-w-[740px]">
          <h1
            className="landing-fade-up text-5xl font-semibold tracking-tighter text-white sm:text-6xl md:text-7xl leading-[1.03]"
            style={{ animationDelay: "30ms" }}
          >
            Generate anything from your terminal.
          </h1>
          <p
            className="landing-fade-up mt-5 text-base text-[#888] leading-relaxed"
            style={{ animationDelay: "90ms" }}
          >
            A tiny CLI for generating text, images, and video with dead-simple
            commands. Pipe content in and out. Compare models side by side. See
            results inline.
          </p>
        </div>

        <div
          className="landing-fade-up mt-8 flex items-center gap-4"
          style={{ animationDelay: "150ms" }}
        >
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-3 font-mono text-sm text-white/70">
            <span className="text-white/40">$</span>
            <span>npm install -g ai-cli</span>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-16 max-w-[1320px] px-6 md:mt-20">
        <div className="landing-fade-up" style={{ animationDelay: "240ms" }}>
          <Stage tone="slate">
            <div className="mx-auto w-full max-w-[1160px]">
              <Window title="terminal" bar={false}>
                <Terminal />
              </Window>
            </div>
          </Stage>
        </div>
      </div>
    </section>
  );
}
