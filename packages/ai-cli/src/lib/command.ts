type OptionValueParser = (value: string, previous: unknown) => unknown;
type Action = (
  argument: unknown,
  options: Record<string, unknown>
) => unknown | Promise<unknown>;

interface ArgumentDefinition {
  syntax: string;
  name: string;
  description: string;
}

interface OptionDefinition {
  flags: string;
  short?: string;
  long?: string;
  name: string;
  description: string;
  valueName?: string;
  negated: boolean;
  parser?: OptionValueParser;
  defaultValue?: unknown;
}

export class CliUsageError extends Error {}

export class Command {
  private commandName = "";
  private commandDescription = "";
  private commandVersion?: string;
  private readonly parent?: Command;
  private readonly commands: Command[] = [];
  private readonly options: OptionDefinition[] = [];
  private argumentDefinition?: ArgumentDefinition;
  private actionHandler?: Action;

  constructor(parent?: Command) {
    this.parent = parent;
  }

  name(name: string): this {
    this.commandName = name;
    return this;
  }

  description(description: string): this {
    this.commandDescription = description;
    return this;
  }

  version(version: string): this {
    this.commandVersion = version;
    return this;
  }

  command(name: string): Command {
    const command = new Command(this).name(name);
    this.commands.push(command);
    return command;
  }

  argument(syntax: string, description: string): this {
    const name = syntax.replace(/^[<[ ]|[>\] ]$/g, "");
    this.argumentDefinition = { syntax, name, description };
    return this;
  }

  option<T>(
    flags: string,
    description: string,
    parser?: (value: string, previous: T | undefined) => T,
    defaultValue?: T
  ): this {
    const valueMatch = flags.match(/<([^>]+)>/);
    const flagNames = flags
      .replace(/<[^>]+>/g, "")
      .split(/[\s,|]+/)
      .filter((flag) => flag.startsWith("-"));
    const short = flagNames.find(
      (flag) => flag.startsWith("-") && !flag.startsWith("--")
    );
    const long = flagNames.find((flag) => flag.startsWith("--"));
    const canonical = long ?? short;

    if (!canonical) throw new Error(`Invalid option flags: ${flags}`);

    const rawName = canonical.replace(/^--?/, "");
    const negated = rawName.startsWith("no-");
    const name = camelCase(negated ? rawName.slice(3) : rawName);

    this.options.push({
      flags,
      short,
      long,
      name,
      description,
      valueName: valueMatch?.[1],
      negated,
      parser: parser
        ? (value, previous) => parser(value, previous as T | undefined)
        : undefined,
      defaultValue,
    });
    return this;
  }

  action<TArgument, TOptions>(
    handler: (
      argument: TArgument,
      options: TOptions
    ) => unknown | Promise<unknown>
  ): this {
    this.actionHandler = (argument, options) =>
      handler(argument as TArgument, options as TOptions);
    return this;
  }

  async parseAsync(argv: string[]): Promise<void> {
    await this.run(argv.slice(2));
  }

  private async run(args: string[], optionsEnded = false): Promise<void> {
    // Commands such as video have a default action as well as start/status.
    // `--` always permits a prompt that happens to be a subcommand name.
    if (
      this.actionHandler &&
      (optionsEnded ||
        (args[0] !== "help" &&
          !this.commands.some((child) => child.commandName === args[0])))
    ) {
      await this.runLeaf(args, optionsEnded);
      return;
    }
    if (this.commands.length > 0) {
      await this.runParent(args, optionsEnded);
      return;
    }

    await this.runLeaf(args, optionsEnded);
  }

  private async runParent(
    args: string[],
    optionsEnded: boolean
  ): Promise<void> {
    const first = args[0];
    const version = this.findVersion();

    if (
      !optionsEnded &&
      version &&
      hasFlagBeforeTerminator(args, ["-V", "--version"])
    ) {
      process.stdout.write(`${version}\n`);
      return;
    }
    if (!first) {
      this.writeHelp(process.stderr);
      throw new CliUsageError();
    }
    if (!optionsEnded && first === "--") {
      await this.runParent(args.slice(1), true);
      return;
    }

    const command = this.commands.find(
      (candidate) => candidate.commandName === first
    );
    if (command) {
      await command.run(args.slice(1), optionsEnded);
      return;
    }

    if (first === "help") {
      this.writeHelpCommand(args.slice(1));
      return;
    }
    if (!optionsEnded && hasFlagBeforeTerminator(args, ["-h", "--help"])) {
      this.writeHelp(process.stdout);
      return;
    }
    if (!optionsEnded && first.startsWith("-")) {
      throw new CliUsageError(
        `unknown option '${first}'${suggestSimilar(first, this.optionCandidates())}`
      );
    }

    const candidates = [
      ...this.commands.map(({ commandName }) => commandName),
      "help",
    ];
    throw new CliUsageError(
      `unknown command '${first}'${suggestSimilar(first, candidates)}`
    );
  }

  private async runLeaf(
    args: string[],
    inheritedOptionsEnded: boolean
  ): Promise<void> {
    if (!inheritedOptionsEnded && this.hasHelpFlag(args)) {
      this.writeHelp(process.stdout);
      return;
    }

    const values = Object.fromEntries(
      this.options
        .filter((option) => option.defaultValue !== undefined)
        .map((option) => [
          option.name,
          Array.isArray(option.defaultValue)
            ? [...option.defaultValue]
            : option.defaultValue,
        ])
    );
    const positionals: string[] = [];
    let optionsEnded = inheritedOptionsEnded;

    for (let index = 0; index < args.length; index++) {
      const token = args[index]!;

      const version = this.findVersion();
      if (
        !optionsEnded &&
        version &&
        (token === "-V" || token === "--version")
      ) {
        process.stdout.write(`${version}\n`);
        return;
      }
      if (!optionsEnded && token === "--") {
        optionsEnded = true;
        continue;
      }
      if (
        !optionsEnded &&
        token.startsWith("-") &&
        token !== "-" &&
        !isNegativeNumber(token)
      ) {
        const matches = this.findOptions(token);

        for (const { option, inlineValue } of matches) {
          if (!option.valueName) {
            if (inlineValue !== undefined) {
              throw new CliUsageError(
                `option '${option.long}' does not take a value`
              );
            }
            values[option.name] = option.negated ? false : true;
            continue;
          }

          let value = inlineValue;
          if (value === undefined) {
            value = args[++index];
            if (value === undefined) {
              throw new CliUsageError(
                `option '${option.flags}' argument missing`
              );
            }
          }

          values[option.name] = option.parser
            ? option.parser(value, values[option.name])
            : value;
        }
        continue;
      }

      positionals.push(token);
    }

    if (positionals.length > (this.argumentDefinition ? 1 : 0)) {
      const expected = this.argumentDefinition ? 1 : 0;
      throw new CliUsageError(
        `too many arguments for '${this.commandName}'. Expected ${expected} argument${expected === 1 ? "" : "s"} but got ${positionals.length}.`
      );
    }
    if (!this.actionHandler) return;

    await this.actionHandler(positionals[0], values);
  }

  private hasHelpFlag(args: string[]): boolean {
    let hasHelp = false;

    for (let index = 0; index < args.length; index++) {
      const token = args[index]!;

      if (token === "--") return hasHelp;
      if (
        token === "-h" ||
        token === "--help" ||
        this.isCombinedHelpOption(token)
      ) {
        hasHelp = true;
        continue;
      }
      if (!token.startsWith("-") || token === "-" || isNegativeNumber(token)) {
        continue;
      }

      let matches: ReturnType<Command["findOptions"]>;
      try {
        matches = this.findOptions(token);
      } catch (error) {
        if (!(error instanceof CliUsageError)) throw error;
        continue;
      }

      const optionWithoutValue = matches.find(
        ({ option, inlineValue }) =>
          option.valueName &&
          inlineValue === undefined &&
          args[index + 1] === undefined
      );
      if (optionWithoutValue) {
        throw new CliUsageError(
          `option '${optionWithoutValue.option.flags}' argument missing`
        );
      }
      if (
        matches.some(
          ({ option, inlineValue }) =>
            option.valueName && inlineValue === undefined
        )
      ) {
        index++;
      }
    }

    return hasHelp;
  }

  private isCombinedHelpOption(token: string): boolean {
    if (!token.startsWith("-") || token.startsWith("--")) return false;

    for (let index = 1; index < token.length; index++) {
      const flag = `-${token[index]}`;
      if (flag === "-h") return index === token.length - 1;

      const option = this.options.find((candidate) => candidate.short === flag);
      if (!option || option.valueName) return false;
    }

    return false;
  }

  private findOptions(token: string): {
    option: OptionDefinition;
    inlineValue?: string;
  }[] {
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      const flag = equals === -1 ? token : token.slice(0, equals);
      const option = this.options.find((candidate) => candidate.long === flag);
      if (!option) {
        throw new CliUsageError(
          `unknown option '${token}'${suggestSimilar(
            token,
            this.optionCandidates()
          )}`
        );
      }
      return [
        {
          option,
          inlineValue: equals === -1 ? undefined : token.slice(equals + 1),
        },
      ];
    }

    const exact = this.options.find((candidate) => candidate.short === token);
    if (exact) return [{ option: exact }];

    const matches: { option: OptionDefinition; inlineValue?: string }[] = [];
    let index = 1;

    while (index < token.length) {
      const flag = `-${token[index]}`;
      const option = this.options.find((candidate) => candidate.short === flag);
      if (!option) {
        throw new CliUsageError(`unknown option '-${token.slice(index)}'`);
      }

      if (option.valueName) {
        const inlineValue = token.slice(index + 1) || undefined;
        matches.push({ option, inlineValue });
        return matches;
      }

      matches.push({ option });
      index++;
    }

    return matches;
  }

  private optionCandidates(): string[] {
    return [
      ...(this.parent?.optionCandidates() ?? []),
      "--help",
      ...this.options.flatMap(({ long }) => (long ? [long] : [])),
      ...(this.commandVersion ? ["--version"] : []),
    ];
  }

  private writeHelp(stream: NodeJS.WritableStream): void {
    const hasCommands = this.commands.length > 0;
    const path = this.commandPath();
    const argument = this.argumentDefinition
      ? ` ${this.argumentDefinition.syntax}`
      : "";
    const command = hasCommands ? " [command]" : "";
    stream.write(`Usage: ${path} [options]${command}${argument}\n`);
    if (this.commandDescription) {
      stream.write(`\n${wrapText(this.commandDescription, HELP_WIDTH)}\n`);
    }

    const argumentRows: [string, string][] = this.argumentDefinition
      ? [[this.argumentDefinition.name, this.argumentDefinition.description]]
      : [];
    const optionRows: [string, string][] = this.options.map((option) => [
      option.flags,
      optionDescription(option),
    ]);
    if (this.commandVersion) {
      optionRows.unshift(["-V, --version", "output the version number"]);
    }
    optionRows.push(["-h, --help", "display help for command"]);
    const commandRows: [string, string][] = hasCommands
      ? [
          ...this.commands.map((child): [string, string] => [
            child.helpSignature(),
            child.commandDescription,
          ]),
          ["help [command]", "display help for command"],
        ]
      : [];
    const termWidth = Math.max(
      ...[argumentRows, optionRows, commandRows]
        .flat()
        .map(([label]) => label.length)
    );

    if (this.argumentDefinition) {
      stream.write("\nArguments:\n");
      stream.write(formatRows(argumentRows, termWidth));
    }

    stream.write("\nOptions:\n");
    stream.write(formatRows(optionRows, termWidth));

    if (hasCommands) {
      stream.write("\nCommands:\n");
      stream.write(formatRows(commandRows, termWidth));
    }
  }

  private writeHelpCommand(path: string[]): void {
    const [name] = path;
    if (!name || name === "-h" || name === "--help") {
      this.writeHelp(process.stdout);
      return;
    }

    const command = this.commands.find(
      (candidate) => candidate.commandName === name
    );
    if (!command) throw new CliUsageError(`unknown command '${name}'`);
    command.writeHelp(process.stdout);
  }

  private findVersion(): string | undefined {
    return this.commandVersion ?? this.parent?.findVersion();
  }

  private commandPath(): string {
    const parentPath = this.parent?.commandPath();
    return parentPath ? `${parentPath} ${this.commandName}` : this.commandName;
  }

  private helpSignature(): string {
    const options = this.options.length > 0 ? " [options]" : "";
    const argument = this.argumentDefinition
      ? ` ${this.argumentDefinition.syntax}`
      : "";
    return `${this.commandName}${options}${argument}`;
  }
}

const HELP_WIDTH = 80;
const MIN_WIDTH_TO_WRAP = 40;

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
}

function isNegativeNumber(value: string): boolean {
  return /^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(value);
}

function hasFlagBeforeTerminator(args: string[], flags: string[]): boolean {
  for (const argument of args) {
    if (argument === "--") return false;
    if (flags.includes(argument)) return true;
  }
  return false;
}

function optionDescription(option: OptionDefinition): string {
  if (!option.valueName || option.defaultValue === undefined) {
    return option.description;
  }

  return `${option.description} (default: ${JSON.stringify(
    option.defaultValue
  )})`;
}

function formatRows(rows: [string, string][], termWidth: number): string {
  const descriptionWidth = HELP_WIDTH - termWidth - 4;
  const continuationIndent = " ".repeat(termWidth + 4);

  return rows
    .map(([label, description]) => {
      const formattedDescription =
        descriptionWidth < MIN_WIDTH_TO_WRAP
          ? description
          : wrapText(description, descriptionWidth);
      return `  ${label.padEnd(termWidth)}  ${formattedDescription.replace(
        /\n/g,
        `\n${continuationIndent}`
      )}\n`;
    })
    .join("");
}

function wrapText(value: string, width: number): string {
  if (width < MIN_WIDTH_TO_WRAP) return value;

  return value
    .split(/\r?\n/)
    .flatMap((line) => {
      const words = line.match(/\S+/g);
      if (!words) return [""];

      const wrapped: string[] = [];
      let current = words[0]!;

      for (const word of words.slice(1)) {
        if (current.length + word.length + 1 <= width) {
          current += ` ${word}`;
        } else {
          wrapped.push(current);
          current = word;
        }
      }
      wrapped.push(current);
      return wrapped;
    })
    .join("\n");
}

function suggestSimilar(word: string, candidates: string[]): string {
  const searchingOptions = word.startsWith("--");
  const target = searchingOptions ? word.slice(2) : word;
  const normalizedCandidates = [
    ...new Set(
      candidates.map((candidate) =>
        searchingOptions ? candidate.slice(2) : candidate
      )
    ),
  ];
  const suggestions: string[] = [];
  let bestDistance = 3;

  for (const candidate of normalizedCandidates) {
    if (candidate.length <= 1) continue;

    const distance = editDistance(target, candidate);
    const similarity =
      (Math.max(target.length, candidate.length) - distance) /
      Math.max(target.length, candidate.length);
    if (similarity <= 0.4) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      suggestions.length = 0;
    }
    if (distance === bestDistance) suggestions.push(candidate);
  }

  suggestions.sort((left, right) => left.localeCompare(right));
  const formatted = suggestions.map((candidate) =>
    searchingOptions ? `--${candidate}` : candidate
  );
  if (formatted.length === 0) return "";
  if (formatted.length === 1) {
    return `\n(Did you mean ${formatted[0]}?)`;
  }
  return `\n(Did you mean one of ${formatted.join(", ")}?)`;
}

function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 3) {
    return Math.max(left.length, right.length);
  }

  const distances = Array.from({ length: left.length + 1 }, (_, index) => [
    index,
  ]);
  for (let index = 0; index <= right.length; index++) {
    distances[0]![index] = index;
  }

  for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      distances[leftIndex]![rightIndex] = Math.min(
        distances[leftIndex - 1]![rightIndex]! + 1,
        distances[leftIndex]![rightIndex - 1]! + 1,
        distances[leftIndex - 1]![rightIndex - 1]! + cost
      );

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distances[leftIndex]![rightIndex] = Math.min(
          distances[leftIndex]![rightIndex]!,
          distances[leftIndex - 2]![rightIndex - 2]! + 1
        );
      }
    }
  }

  return distances[left.length]![right.length]!;
}
