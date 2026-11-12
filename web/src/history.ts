import { DIALS, MOODS } from "../../core/profile";

export const HISTORY_KEY = "bne.history.v1";
export const APP_SETTINGS_KEY = "bne.settings.v1";
export const HISTORY_LIMIT = 100;
const ranges: Record<string, [number, number, boolean?]> = {
  length: [3, 14, true],
  page: [1, Number.MAX_SAFE_INTEGER, true],
  energy: [0, 10],
  weight: [0, 10],
  novelty: [0, 10],
  "blend-amount": [0, 1],
  "rdap-concurrency": [1, 6, true],
  "rdap-rate": [1, 160],
  "dns-concurrency": [1, 24, true],
  "dns-rate": [1, 160],
  "dns-timeout": [100, 30000],
  "hedge-delay": [0, 30000],
};
const choices: Record<string, readonly string[]> = {
  mood: Object.keys(MOODS),
  blend: ["", ...Object.keys(MOODS)],
  syllables: ["", "1", "2", "3", "4", "5"],
  opening: ["any", "vowel", "consonant", "cluster"],
  ending: ["", "open", "closed", "either"],
  count: ["20", "50", "200", "1000", "4000"],
};
const toggles = ["check-domains", "filter-available", "use-dns"];
export const CONTROL_IDS = [
  ...Object.keys(ranges),
  ...Object.keys(choices).filter((k) => k !== "mood"),
  ...toggles,
  "seed",
];
export type Controls = Record<string, string | boolean>;
export interface HistoryEntry {
  id: string;
  at: number;
  source: string;
  controls: Controls;
  fresh: boolean;
  reverse?: {
    word: string;
    mode: "dictionary" | "reading" | "phones";
    value: string;
  };
}
export interface AppSettings {
  randomSeed: boolean;
}
export function readAppSettings(text: string | null): AppSettings {
  try {
    const value = JSON.parse(text || "{}");
    return { randomSeed: value?.randomSeed !== false };
  } catch {
    return { randomSeed: true };
  }
}
export function freshSeed(
  previous: string,
  value = crypto.getRandomValues(new Uint32Array(1))[0],
): string {
  return String(String(value) === previous ? (value + 1) >>> 0 : value);
}
export function freshMood(
  previous: string,
  value = crypto.getRandomValues(new Uint32Array(1))[0],
): string {
  const moods = choices.mood.filter((mood) => mood !== previous);
  return moods[value % moods.length];
}
export function validControls(value: unknown): value is Controls {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Controls;
  return (
    Object.keys(c).length === CONTROL_IDS.length + 2 &&
    Object.entries(ranges).every(
      ([key, [min, max, integer]]) =>
        typeof c[key] === "string" &&
        String(c[key]).trim() !== "" &&
        Number(c[key]) >= min &&
        Number(c[key]) <= max &&
        (!integer || Number.isInteger(Number(c[key]))),
    ) &&
    Object.entries(choices).every(
      ([key, values]) =>
        typeof c[key] === "string" && values.includes(c[key] as string),
    ) &&
    toggles.every((key) => typeof c[key] === "boolean") &&
    typeof c.seed === "string" &&
    c.seed.length <= 2000 &&
    /^-?\d+$/.test(c.seed) &&
    typeof c.explicit === "string" &&
    (c.explicit === "" ||
      c.explicit
        .split(",")
        .every((k) => (DIALS as readonly string[]).includes(k))) &&
    c.explicit.length <= 21
  );
}
export function validEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as HistoryEntry,
    r = e.reverse;
  return (
    typeof e.id === "string" &&
    /^[\w-]{1,64}$/.test(e.id) &&
    Number.isFinite(e.at) &&
    e.at > 0 &&
    e.at <= 8640000000000000 &&
    typeof e.source === "string" &&
    e.source.length > 0 &&
    e.source.length <= 120 &&
    typeof e.fresh === "boolean" &&
    validControls(e.controls) &&
    (!r ||
      (typeof r.word === "string" &&
        r.word.trim().length > 0 &&
        r.word.length <= 80 &&
        ["dictionary", "reading", "phones"].includes(r.mode) &&
        typeof r.value === "string" &&
        r.value.length <= 200 &&
        (r.mode === "dictionary" || r.value.trim().length > 0)))
  );
}
export function readHistory(text: string | null): HistoryEntry[] {
  try {
    if (!text || text.length > 1000000) return [];
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value
          .filter(validEntry)
          .sort((a, b) => b.at - a.at)
          .slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function addHistory(entries: HistoryEntry[], entry: HistoryEntry) {
  return validEntry(entry)
    ? [entry, ...entries].slice(0, HISTORY_LIMIT)
    : entries;
}
