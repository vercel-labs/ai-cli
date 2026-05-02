import type { Command } from "commander";

import {
  FALLBACK_TEXT_MODELS,
  FALLBACK_IMAGE_MODELS,
  FALLBACK_VIDEO_MODELS,
} from "../lib/models.js";

export function registerCompletionsCommand(program: Command) {
  program
    .command("completions")
    .description("Output shell completion script")
    .argument("<shell>", "Shell type: zsh, bash, fish")
    .action((shell: string) => {
      switch (shell.toLowerCase()) {
        case "zsh":
          process.stdout.write(generateZsh());
          break;
        case "bash":
          process.stdout.write(generateBash());
          break;
        case "fish":
          process.stdout.write(generateFish());
          break;
        default:
          process.stderr.write(
            `Unknown shell: ${shell}. Supported: zsh, bash, fish\n`
          );
          process.exit(1);
      }
    });
}

const SUBCOMMANDS = ["text", "image", "video", "models", "completions", "help"];
const GLOBAL_FLAGS = [
  "--model",
  "--output",
  "--count",
  "--concurrency",
  "--quiet",
  "--json",
  "--help",
  "--version",
];
const TEXT_FLAGS = ["--format", "--system", "--max-tokens", "--temperature"];
const IMAGE_FLAGS = [
  "--size",
  "--aspect-ratio",
  "--quality",
  "--style",
  "--seed",
  "--no-preview",
];
const VIDEO_FLAGS = ["--aspect-ratio", "--duration", "--no-preview"];
const MODEL_FLAGS = ["--type", "--provider", "--json", "--help"];

const ALL_MODELS = [
  ...FALLBACK_TEXT_MODELS,
  ...FALLBACK_IMAGE_MODELS,
  ...FALLBACK_VIDEO_MODELS,
];
const MODEL_NAMES = ALL_MODELS.map((m) => m.slice(m.indexOf("/") + 1));

function generateZsh(): string {
  return `#compdef ai

_ai() {
  local -a subcommands
  subcommands=(
    'text:Generate text from a prompt'
    'image:Generate an image from a prompt'
    'video:Generate a video from a prompt'
    'models:List available models'
    'completions:Output shell completion script'
    'help:Display help'
  )

  local -a models
  models=(${ALL_MODELS.join(" ")})

  local -a model_names
  model_names=(${MODEL_NAMES.join(" ")})

  _arguments -C \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      _describe 'command' subcommands
      ;;
    args)
      case $words[1] in
        text)
          _arguments \\
            '-m[Model ID]:model:($models $model_names)' \\
            '--model[Model ID]:model:($models $model_names)' \\
            '-o[Output path]:file:_files' \\
            '--output[Output path]:file:_files' \\
            '-f[Format]:format:(md txt)' \\
            '--format[Format]:format:(md txt)' \\
            '-n[Count]:count:' \\
            '--count[Count]:count:' \\
            '-p[Concurrency]:concurrency:' \\
            '--concurrency[Concurrency]:concurrency:' \\
            '-s[System prompt]:system:' \\
            '--system[System prompt]:system:' \\
            '--max-tokens[Max tokens]:tokens:' \\
            '-t[Temperature]:temp:' \\
            '--temperature[Temperature]:temp:' \\
            '-q[Quiet]' \\
            '--quiet[Quiet]' \\
            '--json[JSON output]' \\
            '*:prompt:'
          ;;
        image)
          _arguments \\
            '-m[Model ID]:model:($models $model_names)' \\
            '--model[Model ID]:model:($models $model_names)' \\
            '-o[Output path]:file:_files' \\
            '--output[Output path]:file:_files' \\
            '-n[Count]:count:' \\
            '--count[Count]:count:' \\
            '-p[Concurrency]:concurrency:' \\
            '--concurrency[Concurrency]:concurrency:' \\
            '--size[Size]:size:' \\
            '--aspect-ratio[Aspect ratio]:ratio:' \\
            '--quality[Quality]:quality:(standard hd)' \\
            '--style[Style]:style:(vivid natural)' \\
            '--seed[Random seed for reproducible generations]:seed:' \\
            '--no-preview[Disable inline image preview]' \\
            '-q[Quiet]' \\
            '--quiet[Quiet]' \\
            '--json[JSON output]' \\
            '*:prompt:'
          ;;
        video)
          _arguments \\
            '-m[Model ID]:model:($models $model_names)' \\
            '--model[Model ID]:model:($models $model_names)' \\
            '-o[Output path]:file:_files' \\
            '--output[Output path]:file:_files' \\
            '-n[Count]:count:' \\
            '--count[Count]:count:' \\
            '-p[Concurrency]:concurrency:' \\
            '--concurrency[Concurrency]:concurrency:' \\
            '--aspect-ratio[Aspect ratio]:ratio:' \\
            '--duration[Duration]:seconds:' \\
            '--no-preview[Disable inline video frame preview]' \\
            '-q[Quiet]' \\
            '--quiet[Quiet]' \\
            '--json[JSON output]' \\
            '*:prompt:'
          ;;
        models)
          _arguments \\
            '--type[Filter by type]:type:(text image video)' \\
            '--provider[Filter by provider]:provider:' \\
            '--json[JSON output]'
          ;;
        completions)
          _arguments '1:shell:(zsh bash fish)'
          ;;
      esac
      ;;
  esac
}

_ai "$@"
`;
}

function generateBash(): string {
  return `_ai_completions() {
  local cur prev subcmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  subcmd="\${COMP_WORDS[1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${SUBCOMMANDS.join(" ")}" -- "$cur"))
    return
  fi

  case "$prev" in
    -m|--model)
      COMPREPLY=($(compgen -W "${ALL_MODELS.join(" ")} ${MODEL_NAMES.join(" ")}" -- "$cur"))
      return
      ;;
    -o|--output)
      COMPREPLY=($(compgen -f -- "$cur"))
      return
      ;;
    -f|--format)
      COMPREPLY=($(compgen -W "md txt" -- "$cur"))
      return
      ;;
    --quality)
      COMPREPLY=($(compgen -W "standard hd" -- "$cur"))
      return
      ;;
    --style)
      COMPREPLY=($(compgen -W "vivid natural" -- "$cur"))
      return
      ;;
    --type)
      COMPREPLY=($(compgen -W "text image video" -- "$cur"))
      return
      ;;
  esac

  case "$subcmd" in
    text)
      COMPREPLY=($(compgen -W "${[...GLOBAL_FLAGS, ...TEXT_FLAGS].join(" ")}" -- "$cur"))
      ;;
    image)
      COMPREPLY=($(compgen -W "${[...GLOBAL_FLAGS, ...IMAGE_FLAGS].join(" ")}" -- "$cur"))
      ;;
    video)
      COMPREPLY=($(compgen -W "${[...GLOBAL_FLAGS, ...VIDEO_FLAGS].join(" ")}" -- "$cur"))
      ;;
    models)
      COMPREPLY=($(compgen -W "${MODEL_FLAGS.join(" ")}" -- "$cur"))
      ;;
    completions)
      COMPREPLY=($(compgen -W "zsh bash fish" -- "$cur"))
      ;;
  esac
}

complete -F _ai_completions ai
`;
}

function generateFish(): string {
  const lines: string[] = [];
  lines.push("# ai completions for fish");
  lines.push("");

  for (const sub of SUBCOMMANDS) {
    lines.push(`complete -c ai -n '__fish_use_subcommand' -a '${sub}'`);
  }
  lines.push("");

  const SHORT_FLAG_MAP: Record<string, string> = {
    "--model": "m",
    "--output": "o",
    "--count": "n",
    "--concurrency": "p",
    "--quiet": "q",
    "--format": "f",
    "--system": "s",
    "--temperature": "t",
  };

  const addFlags = (sub: string, flags: string[]) => {
    for (const flag of flags) {
      const name = flag.replace(/^--/, "");
      const short = SHORT_FLAG_MAP[flag];
      const shortPart = short ? ` -s ${short}` : "";
      lines.push(
        `complete -c ai -n '__fish_seen_subcommand_from ${sub}'${shortPart} -l '${name}'`
      );
    }
  };

  addFlags("text", [...GLOBAL_FLAGS, ...TEXT_FLAGS]);
  addFlags("image", [...GLOBAL_FLAGS, ...IMAGE_FLAGS]);
  addFlags("video", [...GLOBAL_FLAGS, ...VIDEO_FLAGS]);
  addFlags("models", MODEL_FLAGS);

  lines.push("");
  lines.push(
    `complete -c ai -n '__fish_seen_subcommand_from completions' -a 'zsh bash fish'`
  );
  lines.push("");

  const modelCompletions = ALL_MODELS.concat(MODEL_NAMES);
  lines.push(
    `complete -c ai -n '__fish_seen_subcommand_from text image video' -s m -l model -a '${modelCompletions.join(" ")}'`
  );
  lines.push(
    `complete -c ai -n '__fish_seen_subcommand_from text' -s f -l format -a 'md txt'`
  );
  lines.push(
    `complete -c ai -n '__fish_seen_subcommand_from image' -l quality -a 'standard hd'`
  );
  lines.push(
    `complete -c ai -n '__fish_seen_subcommand_from image' -l style -a 'vivid natural'`
  );
  lines.push(
    `complete -c ai -n '__fish_seen_subcommand_from models' -l type -a 'text image video'`
  );
  lines.push("");

  return lines.join("\n");
}
