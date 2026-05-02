"use client";

import { useMemo, useState } from "react";

type tone = "input" | "plain" | "dim" | "ok" | "muted";

interface line {
  readonly tone: tone;
  readonly text: string;
}

interface scene {
  readonly name: string;
  readonly data: readonly line[];
}

const scenes: readonly scene[] = [
  {
    name: "image",
    data: [
      {
        tone: "input",
        text: '$ ai image "a sunset" -m "openai/gpt-image-2,bfl/flux-2-pro"',
      },
      { tone: "plain", text: "" },
      { tone: "ok", text: "Saved to /Users/you/output-1.png (3.2s)" },
      { tone: "ok", text: "Saved to /Users/you/output-2.png (4.1s)" },
    ],
  },
  {
    name: "video",
    data: [
      { tone: "input", text: '$ ai image "a dragon" | ai video "animate this"' },
      { tone: "dim", text: "" },
      { tone: "dim", text: "Generating image with openai/gpt-image-2" },
      { tone: "ok", text: "Generating video with bytedance/seedance-2.0" },
      { tone: "plain", text: "" },
      { tone: "ok", text: "Saved to /Users/you/output.mp4 (12.4s)" },
    ],
  },
  {
    name: "text",
    data: [
      { tone: "input", text: "$ git diff | ai text \"explain these changes\"" },
      { tone: "dim", text: "" },
      { tone: "dim", text: "Generating text with openai/gpt-5.5" },
      { tone: "plain", text: "" },
      { tone: "plain", text: "These changes refactor the auth module:" },
      { tone: "plain", text: "" },
      { tone: "plain", text: "  1. Splits session logic into its own file" },
      { tone: "plain", text: "  2. Adds token expiry validation" },
      { tone: "plain", text: "  3. Removes deprecated OAuth1 flow" },
      { tone: "plain", text: "" },
      { tone: "ok", text: "Saved to /Users/you/output.md" },
    ],
  },
];

function style(tone: tone): string {
  switch (tone) {
    case "input": {
      return "text-white/80";
    }
    case "dim": {
      return "text-white/40";
    }
    case "ok": {
      return "text-white/60";
    }
    case "muted": {
      return "text-white/50";
    }
    default: {
      return "text-white/65";
    }
  }
}

export function Terminal() {
  const [slot, setslot] = useState(0);
  const active = scenes[slot];
  const rows = useMemo(() => active.data, [active]);

  return (
    <div className="group flex h-[460px] flex-col overflow-hidden transition-all duration-300 md:h-[520px]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/15 px-3 py-2">
        <div className="flex items-center gap-3 font-mono text-[11px] text-white/40 tabular-nums">
          <div>
            command <span className="text-white/70">ai {active.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-white/40">
          <span className="inline-flex size-1.5 rounded-full bg-white/50" />
          ready
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-[#050505] px-4 py-3 font-mono text-[12px] leading-[1.62] tabular-nums">
        <div className="w-fit min-w-full">
          {rows.map((row, index) => (
            <div
              key={`${active.name}-${index}`}
              className={`${style(row.tone)} whitespace-nowrap transition-colors duration-150`}
            >
              {row.text || "\u00A0"}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/[0.06] bg-black/15 px-2 py-1.5">
        <div className="terminal-scroll flex items-center gap-1 overflow-x-auto font-mono text-[11px] text-white/40">
          {scenes.map((scene, index) => {
            const current = index === slot;
            return (
              <button
                key={scene.name}
                type="button"
                onClick={() => setslot(index)}
                className={`shrink-0 rounded-sm border px-2.5 py-1 transition-colors duration-150 ${
                  current
                    ? "border-white/20 bg-white/[0.08] text-white/85"
                    : "border-transparent text-white/40 hover:border-white/10 hover:text-white/65"
                }`}
                aria-label={`open ${scene.name}`}
              >
                {current ? `*${scene.name}` : scene.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
