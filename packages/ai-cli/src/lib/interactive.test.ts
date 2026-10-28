import { PassThrough } from "node:stream";

import { afterEach, expect, test, vi } from "vitest";

import { Command } from "./command.js";
import { runInteractive } from "./interactive.js";
import { DEFAULTS, resetGatewayCache } from "./models.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const left = "\x1b[D";
const right = "\x1b[C";
const up = "\x1b[A";
const down = "\x1b[B";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetGatewayCache();
});

async function session(
  exercise: (ui: {
    send: (keys: string) => Promise<void>;
    frame: () => string;
    output: () => string;
    calls: Array<{
      mode: string;
      prompt: unknown;
      options: Record<string, unknown>;
    }>;
  }) => Promise<void>
) {
  const stdin = Object.assign(new PassThrough(), { setRawMode: vi.fn() });
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    stdin as unknown as typeof process.stdin
  );
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 40 });
  vi.spyOn(process, "stdout", "get").mockReturnValue(
    stdout as unknown as typeof process.stdout
  );
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("AI_CLI_PREVIEW", "0");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "acme/zeta", type: "image" },
              { id: "acme/alpha", type: "image" },
              { id: "other/alpha", type: "image" },
            ],
          })
        )
    )
  );
  resetGatewayCache();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const text = String(chunk);
    writes.push(text);
    if (text.includes("\x1b[6n")) stdin.emit("data", Buffer.from("\x1b[1;1R"));
    return true;
  });
  const warnings = globalThis.AI_SDK_LOG_WARNINGS;
  const exitCode = process.exitCode;
  const calls: Array<{
    mode: string;
    prompt: unknown;
    options: Record<string, unknown>;
  }> = [];
  const program = new Command().name("ai");
  for (const mode of ["image", "video", "text"]) {
    program
      .command(mode)
      .argument("[prompt]", "Prompt")
      .option("-m, --model <model>", "Model")
      .option("--quiet", "Quiet")
      .option("--no-preview", "Disable preview")
      .option("--n <count>", "Count")
      .option("--aspect-ratio <ratio>", "Ratio")
      .option("--duration <seconds>", "Duration")
      .action((prompt, options: Record<string, unknown>) => {
        calls.push({ mode, prompt, options });
      });
  }
  const send = async (keys: string) => {
    stdin.emit("data", Buffer.from(keys));
    if (keys === "\x1b")
      await new Promise((resolve) => setTimeout(resolve, 550));
    await turn();
    await turn();
  };
  const running = runInteractive(program, "test");
  try {
    await turn();
    await exercise({
      send,
      calls,
      frame: () =>
        [...writes].reverse().find((text) => text.includes("\x1b[J")) ?? "",
      output: () => writes.join(""),
    });
  } finally {
    await send("\x03");
    await send("\x03");
    await send("\x04");
    await running;
    globalThis.AI_SDK_LOG_WARNINGS = warnings;
    process.exitCode = exitCode;
    stdin.destroy();
    stdout.destroy();
  }
  expect(stdin.setRawMode.mock.calls.map(([enabled]) => enabled)).toEqual([
    true,
    false,
  ]);
  expect(stdin.listenerCount("data")).toBe(0);
}

test("edits prompts and recalls submitted history through terminal keys", async () => {
  await session(async ({ send, calls, frame }) => {
    await send(`cat${left}\x7fr${right}!\r`);
    expect(calls[0]?.prompt).toBe("crt!");
    await send("second\r");
    await send(up);
    expect(frame()).toContain("│ second");
    await send(up);
    expect(frame()).toContain("│ crt!");
    await send(`${down}${down}`);
    expect(frame()).toContain("Describe an image");
    await send(`${up}\x01X\x05\x7f\r`);
    expect(calls.map(({ prompt }) => prompt)).toEqual([
      "crt!",
      "second",
      "Xsecon",
    ]);
    await send("discard this\x03");
    expect(frame()).toContain("Describe an image");
    expect(calls).toHaveLength(3);
    await send("xcat\x1b[H\x1b[3~\x1b[F!\x04");
    await send("\r");
    expect(calls[3]?.prompt).toBe("cat!");
    await send(`red blue tail${left.repeat(5)}\x17green\r`);
    expect(calls[4]?.prompt).toBe("red green tail");
    await send(`discard everything${left}\x15fresh\r`);
    expect(calls[5]?.prompt).toBe("fresh");
    await send("/te\tcompleted\r");
    expect(calls[6]).toEqual({
      mode: "text",
      prompt: "completed",
      options: { model: DEFAULTS.text, quiet: true },
    });
  });
});

test("changes settings and filters pickers, with Escape and Ctrl+C cancelling", async () => {
  await session(async ({ send, calls, frame }) => {
    await send(`\t${right}${right}${up}${right}\r16`);
    expect(frame()).toContain("16:9");
    expect(frame()).not.toContain("21:9");
    await send("\r");
    await send("\x1b");
    await send("first\r");
    expect(calls[0]?.options).toMatchObject({ n: "2", aspectRatio: "16:9" });
    await send("/model\r");
    await send("ALPHAx\x7f");
    expect(frame()).not.toContain("acme/zeta");
    expect(frame().indexOf("acme/alpha")).toBeLessThan(
      frame().indexOf("other/alpha")
    );
    await send(`${up}\r`);
    await send("\x03");
    await send("selected\r");
    expect(calls[1]?.options.model).toBe("other/alpha");
    await send("/model\r");
    await send("zeta");
    await send("\x1b");
    await send("\x03");
    await send("cancelled\r");
    expect(calls[2]?.options.model).toBe("other/alpha");
    await send("/model\r");
    await send("zeta\x03");
    await send("also cancelled\r");
    expect(calls[3]?.options.model).toBe("other/alpha");
    await send(`\t${left.repeat(2)}${down} ${up}\r${down}handoff\r`);
    expect(calls[4]).toEqual({
      mode: "image",
      prompt: "handoff",
      options: {
        model: "other/alpha",
        quiet: true,
        preview: false,
        n: "1",
        aspectRatio: "16:9",
      },
    });
  });
});

test("moves through settings with Tab and Shift+Tab, wrapping back to the prompt", async () => {
  await session(async ({ send, calls }) => {
    await send(`\t\t\t${up}\t\tfirst\r`);
    expect(calls[0]).toMatchObject({ prompt: "first", options: { n: "2" } });
    await send(`\x1b[Z${up}`);
    await send("\x1b");
    await send("second\r");
    expect(calls[1]).toMatchObject({
      prompt: "second",
      options: { n: "2", aspectRatio: "1:1" },
    });
  });
});

test("routes slash commands and preserves generation options across modes", async () => {
  await session(async ({ send, calls, output }) => {
    await send("/help\r");
    expect(output()).toContain("Ctrl+D           quit");
    await send("/gallery\r");
    expect(output()).toContain("No images yet.");
    await send("@last\r");
    expect(output()).toContain("@last has no file yet");
    expect(calls).toHaveLength(0);
    await send("/video\r/n 2\r/ratio 9:16\r/duration 6\r/model local/video\r");
    await send("--a scene\r");
    await send("/text answer this\r");
    await send("/ratio 1:1\r");
    expect(output()).toContain("/ratio does not apply to text");
    await send("/image draw this\r");
    expect(calls).toEqual([
      {
        mode: "video",
        prompt: "--a scene",
        options: {
          model: "local/video",
          quiet: true,
          preview: false,
          n: "2",
          aspectRatio: "9:16",
          duration: "6",
        },
      },
      {
        mode: "text",
        prompt: "answer this",
        options: { model: DEFAULTS.text, quiet: true },
      },
      {
        mode: "image",
        prompt: "draw this",
        options: { model: DEFAULTS.image, quiet: true, preview: false, n: "2" },
      },
    ]);
    await send("/clear\r");
    expect(output()).toContain("\x1b[2J\x1b[3J\x1b[H");
  });
});
