import { truncate } from "./interactive-format.js";
import { mediaSettings } from "./media-options.js";
import { DEFAULTS, fetchGatewayModels } from "./models.js";

export type Mode = "image" | "video" | "text";
export type Field = "mode" | "model" | "count" | "ratio" | "duration";

const MODES: Mode[] = ["image", "video", "text"];
const COUNTS = ["1", "2"];
const RATIOS: Record<Exclude<Mode, "text">, string[]> = {
  image: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
  video: ["auto", "16:9", "9:16", "1:1"],
};
const DURATIONS = ["auto", "4", "5", "6", "8", "10"];
export const FIELD_NAMES: Record<Field, string> = {
  mode: "Generate",
  model: "Model",
  count: "How many",
  ratio: "Aspect ratio",
  duration: "Duration (seconds)",
};

export interface Picker {
  field: Field;
  options: string[];
  filter: string;
  index: number;
  loading: boolean;
}

export class Settings {
  mode: Mode = "image";
  private models: Partial<Record<Mode, string>> = {};
  count = 1;
  ratios = { image: "auto", video: "auto" };
  duration = "auto";

  fields(): Field[] {
    if (this.mode === "text") return ["mode", "model"];
    if (this.mode === "image") return ["mode", "model", "count", "ratio"];
    return ["mode", "model", "count", "ratio", "duration"];
  }

  optionsFor(field: Field): string[] {
    if (field === "mode") return MODES;
    if (field === "count") return COUNTS;
    if (field === "duration") return DURATIONS;
    if (field === "ratio" && this.mode !== "text") return RATIOS[this.mode];
    return [];
  }

  current(field: Field): string {
    if (field === "mode") return this.mode;
    if (field === "model") return this.model();
    if (field === "count") return String(this.count);
    if (field === "duration") return this.duration;
    return this.mode === "text" ? "auto" : this.ratios[this.mode];
  }

  label(field: Field): string {
    const value = this.current(field);
    if (field === "model") return truncate(value, 36);
    if (field === "count")
      return `${value} ${this.mode}${value === "1" ? "" : "s"}`;
    if (field === "ratio") return value === "auto" ? "any ratio" : value;
    if (field === "duration")
      return value === "auto" ? "any length" : `${value}s`;
    return value;
  }

  apply(field: Field, value: string): void {
    if (field === "mode") this.mode = value as Mode;
    else if (field === "model") this.models[this.mode] = value;
    else if (field === "count") this.count = Number(value);
    else if (field === "duration") this.duration = value;
    else if (this.mode !== "text") this.ratios[this.mode] = value;
  }

  model(mode = this.mode): string {
    return this.models[mode] ?? DEFAULTS[mode];
  }
}

export function filteredOptions(picker?: Picker): string[] {
  if (!picker) return [];
  const filter = picker.filter.toLowerCase();
  return picker.options
    .map((option) => {
      const name = option.toLowerCase();
      if (!name.includes(filter)) return { option, rank: 3 };
      if ((name.split("/")[1] ?? name).startsWith(filter))
        return { option, rank: 0 };
      const rank = name.split(/[/.-]/).some((part) => part.startsWith(filter))
        ? 1
        : 2;
      return { option, rank };
    })
    .filter(({ rank }) => rank < 3)
    .sort((left, right) => left.rank - right.rank)
    .map(({ option }) => option);
}

export async function modelOptions(mode: Mode): Promise<string[]> {
  const catalog = await fetchGatewayModels(
    mode === "text" ? undefined : (await mediaSettings({})).catalogOptions
  );
  const ids =
    mode === "image"
      ? [
          ...new Set([
            ...catalog.image.map(({ id }) => id),
            ...catalog.languageImageModelIds,
          ]),
        ]
      : catalog[mode].map(({ id }) => id);
  ids.sort();
  return ids;
}
