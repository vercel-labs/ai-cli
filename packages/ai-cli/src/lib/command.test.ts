import { describe, expect, test } from "vitest";

import { Command } from "./command.js";

describe("Command", () => {
  test("routes aliases to subcommands before a parent's default action", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    const video = program
      .command("video")
      .argument("[prompt]", "Prompt")
      .action((prompt) => {
        received = { command: "video", prompt };
      });
    video
      .command("start")
      .alias("create")
      .argument("[prompt]", "Prompt")
      .action((prompt) => {
        received = { command: "start", prompt };
      });

    await program.parseAsync(["node", "ai", "video", "create", "a scene"]);
    expect(received).toEqual({ command: "start", prompt: "a scene" });

    await program.parseAsync(["node", "ai", "video", "--", "create"]);
    expect(received).toEqual({ command: "video", prompt: "create" });
  });

  test("parses positional, long, short, negated, and repeatable options", async () => {
    let received:
      | {
          prompt?: string;
          options: Record<string, unknown>;
        }
      | undefined;

    const program = new Command().name("ai");
    program
      .command("image")
      .argument("[prompt]", "Prompt")
      .option("-m, --model <model>", "Model")
      .option(
        "-i, --image <path>",
        "Image",
        (value, previous: unknown) => [
          ...((previous as string[] | undefined) ?? []),
          value,
        ],
        []
      )
      .option("--aspect-ratio <ratio>", "Aspect ratio")
      .option("--no-preview", "Disable preview")
      .action((prompt, options) => {
        received = {
          prompt: prompt as string | undefined,
          options: options as Record<string, unknown>,
        };
      });

    await program.parseAsync([
      "node",
      "ai",
      "image",
      "a cat",
      "-m",
      "openai/image",
      "-i",
      "one.png",
      "--image=two.png",
      "--aspect-ratio",
      "16:9",
      "--no-preview",
    ]);

    expect(received).toEqual({
      prompt: "a cat",
      options: {
        model: "openai/image",
        image: ["one.png", "two.png"],
        aspectRatio: "16:9",
        preview: false,
      },
    });
  });

  test("accepts options before and after the positional argument", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .option("-q, --quiet", "Quiet")
      .option("-o, --output <path>", "Output")
      .action((prompt, options) => {
        received = { prompt, options };
      });

    await program.parseAsync([
      "node",
      "ai",
      "text",
      "-q",
      "hello",
      "--output=result.md",
    ]);

    expect(received).toEqual({
      prompt: "hello",
      options: { quiet: true, output: "result.md" },
    });
  });

  test("parses combined boolean and value-taking short options", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .option("-q, --quiet", "Quiet")
      .option("-m, --model <model>", "Model")
      .action((prompt, options) => {
        received = { prompt, options };
      });

    await program.parseAsync([
      "node",
      "ai",
      "text",
      "-qmopenai/gpt-5.5",
      "hello",
    ]);

    expect(received).toEqual({
      prompt: "hello",
      options: { quiet: true, model: "openai/gpt-5.5" },
    });
  });

  test("treats negative numbers as positional arguments", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .action((prompt) => {
        received = prompt;
      });

    await program.parseAsync(["node", "ai", "text", "-1.5e-2"]);

    expect(received).toBe("-1.5e-2");
  });

  test("routes root and nested subcommands after option terminators", async () => {
    async function parse(args: string[]) {
      let received: unknown;
      const program = new Command().name("ai");
      program
        .command("text")
        .argument("[prompt]", "Prompt")
        .action((prompt, options) => {
          received = { command: "text", prompt, options };
        });
      program
        .command("audio")
        .command("speak")
        .argument("[text]", "Text")
        .action((text, options) => {
          received = { command: "speak", text, options };
        });

      await program.parseAsync(["node", "ai", ...args]);
      return received;
    }

    expect(await parse(["--", "text", "hello"])).toEqual({
      command: "text",
      prompt: "hello",
      options: {},
    });
    expect(await parse(["audio", "--", "speak", "hello"])).toEqual({
      command: "speak",
      text: "hello",
      options: {},
    });
  });

  test("keeps descendant arguments positional after a parent terminator", async () => {
    async function parse(args: string[]) {
      let received: unknown;
      const program = new Command().name("ai");
      program
        .command("audio")
        .command("speak")
        .argument("[text]", "Text")
        .option("-q, --quiet", "Quiet")
        .action((text, options) => {
          received = { text, options };
        });

      await program.parseAsync(["node", "ai", ...args]);
      return received;
    }

    expect(await parse(["--", "audio", "speak", "-q"])).toEqual({
      text: "-q",
      options: {},
    });
    expect(await parse(["audio", "--", "speak", "--quiet"])).toEqual({
      text: "--quiet",
      options: {},
    });
  });
});
