import { describe, expect, test, vi } from "vitest";

import { Command } from "./command.js";

describe("Command", () => {
  test("groups print help to stdout without errors", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const program = new Command().name("ai");
      program
        .command("audio")
        .command("speak")
        .action(() => {});
      await program.parseAsync(["node", "ai"]);
      await program.parseAsync(["node", "ai", "audio"]);
      expect(stdout.mock.calls.map(([text]) => text).join("")).toContain(
        "Usage: ai audio"
      );
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test("help takes priority over version and both version aliases work", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const program = new Command().name("ai").version("1.2.3");
      program.command("text").action(() => {});
      for (const flag of ["-v", "-V", "--version"]) {
        await program.parseAsync(["node", "ai", "text", flag]);
        expect(stdout.mock.calls.at(-1)?.[0]).toBe("1.2.3\n");
      }
      stdout.mockClear();
      await program.parseAsync(["node", "ai", "text", "--version", "--help"]);
      expect(stdout.mock.calls.map(([text]) => text).join("")).toContain(
        "Usage: ai text"
      );
      stdout.mockClear();
      await program.parseAsync(["node", "ai", "--version", "--help"]);
      expect(stdout.mock.calls.map(([text]) => text).join("")).toContain(
        "-v, --version"
      );
    } finally {
      stdout.mockRestore();
    }
  });

  test("help resolves every segment and reports the nearest valid path", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const program = new Command().name("ai");
      program
        .command("video")
        .command("start")
        .action(() => {});
      await program.parseAsync(["node", "ai", "help", "video", "start"]);
      expect(stdout.mock.calls.map(([text]) => text).join("")).toContain(
        "Usage: ai video start"
      );
      await expect(
        program.parseAsync(["node", "ai", "help", "video", "strt"])
      ).rejects.toThrow(
        `unknown command 'strt'\n(Did you mean start?)\nRun "ai video --help" for usage.`
      );
    } finally {
      stdout.mockRestore();
    }
  });

  test("usage errors retain suggestions and point to resolved help", async () => {
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .option("--model <name>", "Model")
      .action(() => {});
    await expect(program.parseAsync(["node", "ai", "texte"])).rejects.toThrow(
      `unknown command 'texte'\n(Did you mean text?)\nRun "ai --help" for usage.`
    );
    await expect(
      program.parseAsync(["node", "ai", "text", "--modle"])
    ).rejects.toThrow(
      `unknown option '--modle'\n(Did you mean --model?)\nRun "ai text --help" for usage.`
    );
    await expect(
      program.parseAsync(["node", "ai", "text", "one", "two"])
    ).rejects.toThrow('Run "ai text --help" for usage.');
  });

  test("examples, notes and hidden options affect help but not parsing", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      let received: unknown;
      const program = new Command().name("ai");
      const leaf = program
        .command("text")
        .argument("[prompt]", "Prompt")
        .option("--no-browser", "Disable browser")
        .hideOption("--no-browser")
        .example("ai text hello", "Generate text")
        .example("ai text goodbye")
        .note("First note")
        .note("Second note")
        .action((_arg, options) => {
          received = options;
        });
      await program.parseAsync(["node", "ai", "text", "--help"]);
      const help = stdout.mock.calls.map(([text]) => text).join("");
      expect(help).toContain("[prompt]");
      expect(help).not.toContain("--no-browser");
      expect(help).toContain(
        "Examples:\n  Generate text\n  $ ai text hello\n  $ ai text goodbye"
      );
      expect(help).toContain("Notes:\n  First note\n  Second note");
      expect(leaf.definition().options[0]).toMatchObject({
        long: "--no-browser",
        hidden: true,
      });
      await program.parseAsync(["node", "ai", "text", "--no-browser"]);
      expect(received).toEqual({ browser: false });
    } finally {
      stdout.mockRestore();
    }
  });

  test("JSON help returns the resolved command definition through either entry point", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const program = new Command().name("ai");
      const leaf = program
        .command("video")
        .command("start")
        .option("--json", "JSON")
        .action(() => {});
      for (const args of [
        ["video", "start", "--help", "--json"],
        ["help", "video", "start", "--json"],
      ]) {
        stdout.mockClear();
        await program.parseAsync(["node", "ai", ...args]);
        expect(stdout.mock.calls.map(([text]) => text).join("")).toBe(
          `${JSON.stringify(leaf.definition(), null, 2)}\n`
        );
      }
    } finally {
      stdout.mockRestore();
    }
  });

  test("help wraps to the TTY width, bounded between 80 and 120", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    try {
      const program = new Command()
        .name("ai")
        .description(Array(30).fill("example").join(" "));
      program.command("text").action(() => {});
      for (const [tty, size, width] of [
        [true, 40, 80],
        [true, 100, 100],
        [true, 200, 120],
        [false, 100, 80],
      ] as const) {
        Object.defineProperty(process.stdout, "isTTY", {
          configurable: true,
          value: tty,
        });
        Object.defineProperty(process.stdout, "columns", {
          configurable: true,
          value: size,
        });
        stdout.mockClear();
        await program.parseAsync(["node", "ai", "--help"]);
        const lines = stdout.mock.calls
          .map(([text]) => text)
          .join("")
          .split("\n");
        const descriptionLines = lines.filter((line) =>
          line.startsWith("example")
        );
        expect(
          Math.max(...descriptionLines.map((line) => line.length))
        ).toBeLessThanOrEqual(width);
        expect(descriptionLines[0]!.length).toBeGreaterThan(width - 8);
      }
    } finally {
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else Reflect.deleteProperty(process.stdout, "isTTY");
      if (columns) Object.defineProperty(process.stdout, "columns", columns);
      else Reflect.deleteProperty(process.stdout, "columns");
      stdout.mockRestore();
    }
  });

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
