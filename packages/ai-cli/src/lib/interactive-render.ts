import { bold, dim, inverse, truncate } from "./interactive-format.js";
import {
  FIELD_NAMES,
  filteredOptions,
  type Mode,
  type Picker,
  type Settings,
} from "./interactive-settings.js";
import { formatElapsed } from "./progress.js";
import { nextShimmerPos, shimmerText } from "./shimmer.js";
import { loaderFrame } from "./tui-media.js";

const EXPECTED_MS: Record<Mode, number> = {
  image: 20_000,
  video: 90_000,
  text: 5_000,
};
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PLACEHOLDERS: Record<Mode, string> = {
  image: "Describe an image",
  video: "Describe a video",
  text: "Ask anything",
};

export interface Busy {
  mode: Mode;
  count: number;
  start: number;
  tick: number;
  shimmer: number;
}

interface LiveState {
  settings: Settings;
  focus: "input" | "settings";
  chip: number;
  picker?: Picker;
  input: string;
  cursor: number;
  menuIndex: number;
  busy?: Busy;
  menu: Array<{ usage: string; about: string }>;
}

const PICKER_ROWS = 8;

export function liveLines(
  state: LiveState,
  width: number
): { lines: string[]; row: number; col: number } {
  const lines: string[] = [];
  if (state.busy) {
    const elapsedMs = Date.now() - state.busy.start;
    if (state.busy.mode === "text") {
      const label = `${SPINNER[state.busy.tick % SPINNER.length]} Writing ${formatElapsed(elapsedMs)}`;
      lines.push(`  ${shimmerText(label, state.busy.shimmer)}`);
      state.busy.shimmer = nextShimmerPos(state.busy.shimmer, label.length);
    } else
      lines.push(
        ...loaderFrame(state.busy.count, {
          width,
          tick: state.busy.tick,
          elapsedMs,
          expectedMs: EXPECTED_MS[state.busy.mode],
        })
      );
    lines.push("");
  }
  const room = Math.max(10, width - 4);
  const offset = Math.max(0, state.cursor - room);
  let row = lines.length;
  let col = 2 + state.cursor - offset;
  lines.push(
    `${bold("│")} ${
      state.input
        ? state.input.slice(offset, offset + room)
        : dim(truncate(PLACEHOLDERS[state.settings.mode], width - 4))
    }`
  );
  if (state.picker) {
    const title = `${FIELD_NAMES[state.picker.field]}: `;
    row = lines.length;
    col = 2 + title.length + state.picker.filter.length;
    lines.push(
      `  ${dim(title)}${state.picker.filter}${state.picker.filter ? "" : dim("type to filter")}`
    );
    const options = filteredOptions(state.picker);
    const start = Math.max(
      0,
      Math.min(
        state.picker.index - Math.floor(PICKER_ROWS / 2),
        options.length - PICKER_ROWS
      )
    );
    if (state.picker.loading) lines.push(`  ${dim("Loading models…")}`);
    else if (!options.length) lines.push(`  ${dim("No matches")}`);
    options.slice(start, start + PICKER_ROWS).forEach((option, offset) => {
      const selected = start + offset === state.picker!.index;
      const text = truncate(option, width - 6);
      lines.push(selected ? `  ${inverse(` ${text} `)}` : `   ${text}`);
    });
    if (options.length > PICKER_ROWS)
      lines.push(`  ${dim(`${state.picker.index + 1}/${options.length}`)}`);
  } else
    state.menu.forEach((command, index) => {
      const text = truncate(
        `${command.usage.padEnd(18)} ${command.about}`,
        width - 4
      );
      lines.push(`  ${index === state.menuIndex ? inverse(text) : dim(text)}`);
    });
  lines.push("", footer(state, width), hint(state, width));
  return { lines, row, col };
}

function footer(state: LiveState, width: number): string {
  const labels = state.settings
    .fields()
    .map((field) => state.settings.label(field));
  const status = state.busy ? "   generating" : "";
  const chips = labels
    .map((label, index) =>
      state.focus === "settings" && index === state.chip
        ? inverse(` ${label} `)
        : index === 0
          ? bold(label)
          : dim(label)
    )
    .join(dim(" · "));
  return `${labels.join(" · ")}${status}`.length < width - 2
    ? `${chips}${dim(status)}`
    : chips;
}

function hint(state: LiveState, width: number): string {
  const hint = state.picker
    ? "↑/↓ choose · type to filter · enter apply · esc back"
    : state.focus === "settings"
      ? "tab/←/→ move · ↑/↓ change · enter list · esc back"
      : "enter generate · tab settings · / commands";
  return dim(truncate(hint, width - 1));
}
