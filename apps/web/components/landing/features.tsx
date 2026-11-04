"use client";

import type { ReactNode } from "react";

import { Stage } from "./stage";
import { Window } from "./window";

interface row {
  readonly tone: "cmd" | "code" | "dim";
  readonly text: string;
}

const multimodelrows: readonly row[] = [
  { tone: "cmd", text: '$ ai image "a sunset" -m "gpt-image-2,flux-2-pro"' },
  { tone: "dim", text: "" },
  { tone: "code", text: "Saved to /Users/you/resp_img_a-1.png (3.2s)" },
  { tone: "code", text: "Saved to /Users/you/resp_img_b-2.jpg (4.7s)" },
];

const evaluationrows: readonly row[] = [
  { tone: "dim", text: "$ cat ticket.txt |" },
  { tone: "cmd", text: "  ai decide \\" },
  { tone: "cmd", text: '    --boolean "refund=Refund requested?" \\' },
  { tone: "cmd", text: '    --choice "team=Which team?" \\' },
  { tone: "cmd", text: '    --choices "team=billing,support" \\' },
  { tone: "cmd", text: '    --score "tone=How positive?" \\' },
  { tone: "cmd", text: '    --levels "tone=angry,neutral,happy"' },
];

const pipingrows: readonly row[] = [
  { tone: "cmd", text: '$ git diff | ai text "explain these changes"' },
  { tone: "dim", text: "" },
  { tone: "code", text: "These changes refactor the auth module:" },
  { tone: "code", text: "" },
  { tone: "code", text: "  1. Splits session logic into its own file" },
  { tone: "code", text: "  2. Adds token expiry validation" },
  { tone: "code", text: "  3. Removes deprecated OAuth1 flow" },
  { tone: "dim", text: "" },
  { tone: "cmd", text: '$ ai image "a dragon" | ai video "animate this"' },
  { tone: "code", text: "Saved to /Users/you/resp_video.mp4" },
  { tone: "dim", text: "" },
  { tone: "cmd", text: '$ echo "Ship the changelog" | ai audio speak' },
  { tone: "code", text: "Saved to /Users/you/resp_speech.mp3" },
];

const modelrows: readonly row[] = [
  { tone: "cmd", text: "$ ai models --type audio" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "Speech models (8):" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "  openai" },
  { tone: "code", text: "    tts-1" },
  { tone: "code", text: "    gpt-4o-mini-tts" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "Transcription models (4):" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "  openai" },
  { tone: "code", text: "    whisper-1" },
  { tone: "dim", text: "  ...and more" },
];

function rowstyle(tone: row["tone"]): string {
  switch (tone) {
    case "cmd": {
      return "text-white/75";
    }
    case "dim": {
      return "text-white/35";
    }
    default: {
      return "text-white/60";
    }
  }
}

function Panel({ rows }: { readonly rows: readonly row[] }) {
  return (
    <div className="flex h-[280px] flex-col overflow-hidden bg-[#050505]">
      <div className="flex-1 overflow-x-auto overflow-y-auto px-5 py-4 font-mono text-[12px] leading-[1.65] tabular-nums sm:text-[13px]">
        <div className="w-fit min-w-full whitespace-pre">
          {rows.map((entry, index) => (
            <div key={`${entry.text}-${index}`} className={rowstyle(entry.tone)}>
              {entry.text || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spotlight({
  tone,
  title,
  description,
  bullets,
  flip,
  window,
}: {
  readonly tone: "slate" | "ash" | "iron";
  readonly title: string;
  readonly description: string;
  readonly bullets: readonly string[];
  readonly flip?: boolean;
  readonly window: ReactNode;
}) {
  return (
    <div className="grid min-w-0 items-center gap-10 overflow-hidden md:grid-cols-2 md:gap-16">
      <div className={`min-w-0 ${flip ? "order-1 md:order-2" : "order-1 md:order-1"}`}>
        <h2 className="text-2xl font-semibold tracking-tight text-gray-1000 sm:text-3xl">
          {title}
        </h2>
        <p className="mt-4 text-sm text-gray-900 leading-relaxed">
          {description}
        </p>
        <ul className="mt-8 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-3 text-sm text-gray-1000">
              <span className="h-1 w-1 rounded-full bg-gray-700" />
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div className={`min-w-0 ${flip ? "order-2 md:order-1" : "order-2 md:order-2"}`}>
        <Stage tone={tone}>
          <div className="mx-auto w-full min-w-0 max-w-[1160px]">
            <Window title="" bar={false}>
              {window}
            </Window>
          </div>
        </Stage>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section>
      <div className="mx-auto max-w-[1320px] overflow-hidden px-6 pt-20 pb-20 md:pt-28 md:pb-28">
        <div className="space-y-16 md:space-y-28">
          <Spotlight
            tone="slate"
            title="Compare models in one command."
            description="Pass comma-separated model IDs to run the same prompt on each model in parallel. Add -n to generate several outputs per model."
            bullets={[
              "--concurrency caps parallel requests",
              "--json writes outputs, usage, and provider metadata",
            ]}
            window={<Panel rows={multimodelrows} />}
          />

          <Spotlight
            tone="slate"
            title="Ask typed questions with ai decide."
            description="Send text, JSON, or images as shared state and ask several Boolean, choice, and score questions in one call. Answers come back as JSON with probabilities, ready for jq or a script."
            bullets={[
              "--boolean, --choice, and --score in the same call",
              "--questions loads a reusable JSON question file",
              "default model: typesafe-ai/jev on AI Gateway",
            ]}
            window={<Panel rows={evaluationrows} />}
          />

          <Spotlight
            tone="ash"
            title="Pipe in, pipe out."
            description="Text on stdin becomes prompt context. Binary stdin feeds the image, video, and audio commands, so ai image can pipe straight into ai video."
            bullets={[
              "text stdin becomes prompt context",
              "binary stdin for image, video, and audio workflows",
              "chain: ai image | ai video, or pipe text to ai audio speak",
            ]}
            flip
            window={<Panel rows={pipingrows} />}
          />

          <Spotlight
            tone="iron"
            title="One key for every model type."
            description="Vercel AI Gateway serves text, image, video, speech, transcription, and evaluation models from OpenAI, Anthropic, Google, Black Forest Labs, ByteDance, and more with one API key."
            bullets={[
              "short names resolve automatically: flux-2-pro, gpt-5.5, tts-1",
              "live model listing from the gateway",
              "per-type defaults through AI_CLI_*_MODEL env vars",
            ]}
            window={<Panel rows={modelrows} />}
          />
        </div>
      </div>
    </section>
  );
}
