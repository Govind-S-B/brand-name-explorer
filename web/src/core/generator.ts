import constants from "./constants.json";
import { PythonRandom } from "./random";
export const MOODS = constants.moods;
export const DIALS = ["energy", "weight", "novelty"] as const;
export type Dial = (typeof DIALS)[number];
export type Opening = "any" | "vowel" | "consonant" | "cluster";
export type Ending = "open" | "closed" | "either";
export interface Profile {
  energy: number;
  weight: number;
  novelty: number;
  ending: Ending;
}
export interface Settings {
  mood?: string;
  length?: number;
  seed?: string | number;
  blend?: string;
  energy?: number;
  weight?: number;
  novelty?: number;
  syllables?: number | null;
  ending?: Ending;
  opening?: Opening;
  style?: string;
}
export type Inventory = [string, string[]][];
export const ONSETS = constants.onsets as Inventory;
export const MIDDLES = constants.middles as Inventory;
export const CODAS = constants.codas as Inventory;
export const VOWELS = constants.vowels;
export const CONSONANT_PHONES = constants.consonant_phones as Record<
  string,
  string
>;
export const VOWEL_PHONES = constants.vowel_phones as Record<string, string>;
const classes = constants.classes as Record<string, string>;
const effects = constants.effects as Record<string, number[]>;
const fronts = new Set(constants.front_vowels);
const scales = [0.6, 0.49, 0.4];
export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
export function sum(values: number[]): number {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const next = total + value;
    correction +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + correction;
}
export function resolveProfile(settings: Settings = {}): Profile {
  const { mood = "calm", blend, ending } = settings;
  if (!Object.hasOwn(MOODS, mood)) throw new Error(`unknown mood: ${mood}`);
  const result = { ...MOODS[mood as keyof typeof MOODS] } as Profile;
  if (blend) {
    const parts = blend.split(":");
    const amount = Number(parts[1]);
    if (
      parts.length !== 2 ||
      !parts[1].trim() ||
      !Object.hasOwn(MOODS, parts[0]) ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1
    )
      throw new Error("Blend needs a known mood and a fraction from 0 to 1");
    const other = MOODS[parts[0] as keyof typeof MOODS];
    for (const dial of DIALS)
      result[dial] = (1 - amount) * result[dial] + amount * other[dial];
  }
  for (const dial of DIALS) {
    const v = settings[dial];
    if (v !== undefined) {
      if (!Number.isFinite(v) || v < 0 || v > 10)
        throw new Error(`${dial} must be between 0 and 10`);
      result[dial] = v;
    }
    result[dial] = Number(result[dial].toFixed(8));
  }
  if (ending !== undefined) {
    if (!["open", "closed", "either"].includes(ending))
      throw new Error("ending must be open, closed, or either");
    result.ending = ending;
  }
  return result;
}
interface Token {
  text: string;
  weight: number;
}
export class Shape {
  private memo = new Map<string, [number, number]>();
  count: number;
  mass: number;
  constructor(
    public slots: Token[][],
    public length: number,
    public prior: number,
  ) {
    [this.count, this.mass] = this.partition(0, length);
  }
  partition(depth: number, left: number): [number, number] {
    if (depth === this.slots.length) return left === 0 ? [1, 1] : [0, 0];
    if (left < 0) return [0, 0];
    const key = `${depth}/${left}`;
    const saved = this.memo.get(key);
    if (saved) return saved;
    let count = 0,
      mass = 0;
    for (const token of this.slots[depth]) {
      const [n, w] = this.partition(depth + 1, left - token.text.length);
      count += n;
      mass += token.weight * w;
    }
    const result: [number, number] = [count, mass];
    this.memo.set(key, result);
    return result;
  }
}
export class MoodSpace {
  shapes: Shape[] = [];
  capacity = 0;
  profile: Profile;
  length: number;
  seed: string | number;
  opening: Opening;
  constructor(public settings: Settings = {}) {
    const {
      length = 6,
      seed = 42,
      syllables = null,
      opening = "any",
    } = settings;
    if (!Number.isInteger(length) || length < 3 || length > 14)
      throw new Error("mood length must be from 3 to 14 characters");
    if (
      syllables !== null &&
      (!Number.isInteger(syllables) || syllables < 1 || syllables > 5)
    )
      throw new Error("syllables must be from 1 to 5");
    if (!["any", "vowel", "consonant", "cluster"].includes(opening))
      throw new Error("opening must be vowel, consonant, cluster, or any");
    this.profile = resolveProfile(settings);
    this.length = length;
    this.seed = seed;
    this.opening = opening;
    const target = DIALS.map((d) => (this.profile[d] - 5) / 5);
    const consonants = (items: Inventory): Token[] =>
      items.map(([text, sounds]) => {
        const vector = scales.map(
          (_, i) =>
            sum(sounds.map((s) => effects[classes[s]][i])) / sounds.length,
        );
        const score = sum(target.map((t, i) => (t * vector[i]) / scales[i]));
        const cluster =
          sounds.length > 1 ? 0.12 * Math.exp(1.2 * target[2]) : 1;
        return { text, weight: Math.exp(1.5 * score) * cluster };
      });
    let onsetItems = ONSETS;
    if (opening === "consonant")
      onsetItems = ONSETS.filter(([, s]) => s.length === 1);
    if (opening === "cluster")
      onsetItems = ONSETS.filter(([, s]) => s.length > 1);
    const [onset, middle, coda] = [onsetItems, MIDDLES, CODAS].map(consonants);
    const vowels = VOWELS.map((text) => ({
      text,
      weight:
        Math.exp(0.9 * (target[0] - target[1]) * (fronts.has(text) ? 1 : -1)) *
        (text.length > 1 ? 0.25 : 1),
    }));
    for (const size of syllables ? [syllables] : [1, 2, 3, 4, 5])
      for (const starts of [false, true]) {
        if (
          (opening === "vowel" && starts) ||
          (["consonant", "cluster"].includes(opening) && !starts)
        )
          continue;
        for (const ends of [false, true]) {
          if (
            this.profile.ending !== "either" &&
            ends !== (this.profile.ending === "closed")
          )
            continue;
          const slots: Token[][] = [...(starts ? [onset] : []), vowels];
          for (let i = 0; i < size - 1; i++) slots.push(middle, vowels);
          if (ends) slots.push(coda);
          const preferred = Math.min(
            5,
            Math.max(1, Math.floor((ends ? length - 1 : length + 1) / 2)),
          );
          const prior =
            Math.exp(-2 * (size - preferred) ** 2) * (starts ? 0.85 : 0.15);
          const shape = new Shape(slots, length, prior);
          if (shape.count) this.shapes.push(shape);
        }
      }
    this.capacity = sum(this.shapes.map((s) => s.count));
    if (!this.capacity)
      throw new Error(
        `no words fit opening=${opening}, syllables=${syllables || "auto"}, ending=${this.profile.ending}, length=${length}; relax a structural or length constraint`,
      );
  }
  *names(): Generator<string> {
    const rng = new PythonRandom(this.seed),
      removed = new Map<string, [number, number]>();
    const available = (key: string, mass: number, count: number) => {
      const [used, n] = removed.get(key) || [0, 0];
      return n === count ? 0 : Math.max(mass - used, mass * 1e-14);
    };
    const choose = (options: [number, number][]) => {
      let threshold = rng.random() * sum(options.map((x) => x[1]));
      for (const [v, w] of options) {
        threshold -= w;
        if (threshold < 0) return v;
      }
      return options.at(-1)![0];
    };
    for (let n = 0; n < this.capacity; n++) {
      const route = choose(
        this.shapes
          .map(
            (s, i) =>
              [i, available(String(i), s.prior, s.count)] as [number, number],
          )
          .filter((x) => x[1] > 0),
      );
      const shape = this.shapes[route];
      let key = String(route),
        left = this.length,
        prefixMass = shape.prior / shape.mass;
      const keys = [key],
        parts = [];
      for (let depth = 0; depth < shape.slots.length; depth++) {
        const slot = shape.slots[depth],
          options: [number, number][] = [];
        slot.forEach((token, index) => {
          const [count, mass] = shape.partition(
            depth + 1,
            left - token.text.length,
          );
          if (count) {
            const remaining = available(
              key + "/" + index,
              prefixMass * token.weight * mass,
              count,
            );
            if (remaining > 0) options.push([index, remaining]);
          }
        });
        const index = choose(options),
          token = slot[index];
        key += "/" + index;
        keys.push(key);
        parts.push(token.text);
        left -= token.text.length;
        prefixMass *= token.weight;
      }
      for (const prefix of keys) {
        const [mass, count] = removed.get(prefix) || [0, 0];
        removed.set(prefix, [mass + prefixMass, count + 1]);
      }
      yield capitalize(parts.join(""));
    }
  }
}
function permutations(items: string[], length: number): string[][] {
  if (!length) return [[]];
  return items.flatMap((v, i) =>
    permutations(
      items.filter((_, j) => i !== j),
      length - 1,
    ).map((t) => [v, ...t]),
  );
}
export class LegacySpace {
  capacity: number;
  length: number;
  private pattern: string;
  private consonants: string[][];
  private pools: string[][];
  constructor(public settings: Settings) {
    const style = settings.style || "calm",
      config = (
        constants.presets as Record<string, typeof constants.presets.calm>
      )[style];
    if (!config) throw new Error("Unknown original style");
    this.length = settings.length ?? config.pattern.length;
    const vowelFirst = config.pattern[0] === "V",
      min = vowelFirst ? 3 : 2,
      max = 2 * new Set(config.consonants).size + Number(vowelFirst);
    if (
      !Number.isInteger(this.length) ||
      this.length < min ||
      this.length > max ||
      this.length % 2 !== Number(vowelFirst)
    )
      throw new Error(
        `${style} length must be ${vowelFirst ? "odd" : "even"}, from ${min} to ${max}; names end in a vowel and consonants cannot repeat`,
      );
    this.pattern = (vowelFirst ? "VC" : "CV")
      .repeat(this.length)
      .slice(0, this.length);
    this.consonants = permutations(
      [...new Set(config.consonants)],
      this.pattern.split("C").length - 1,
    );
    this.pools = [...this.pattern].flatMap((s, i) =>
      s === "V"
        ? [
            [
              ...new Set(
                i === 0
                  ? config.starts
                  : i === this.length - 1
                    ? config.endings
                    : config.vowels,
              ),
            ],
          ]
        : [],
    );
    this.capacity = this.pools.reduce(
      (n, p) => n * p.length,
      this.consonants.length,
    );
  }
  *names(): Generator<string> {
    const rng = new PythonRandom(this.settings.seed ?? 42),
      swaps = new Map<number, number>();
    for (let index = 0; index < this.capacity; index++) {
      const chosen = index + rng.randbelow(this.capacity - index),
        value = swaps.get(chosen) ?? chosen,
        replacement = swaps.get(index) ?? index;
      swaps.delete(index);
      if (chosen !== index) swaps.set(chosen, replacement);
      let remainder = value;
      const vowels: string[] = [];
      for (const pool of [...this.pools].reverse()) {
        vowels.push(pool[remainder % pool.length]);
        remainder = Math.floor(remainder / pool.length);
      }
      vowels.reverse();
      let ci = 0,
        vi = 0;
      yield capitalize(
        [...this.pattern]
          .map((s) =>
            s === "C" ? this.consonants[remainder][ci++] : vowels[vi++],
          )
          .join(""),
      );
    }
  }
}
export const createSpace = (s: Settings) =>
  s.style ? new LegacySpace(s) : new MoodSpace(s);
export function generate(
  settings: Settings = {},
  count = 200,
  page = 1,
): string[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isInteger(page) ||
    page < 1
  )
    throw new Error("count and page must be at least 1");
  const space = createSpace(settings),
    start = (page - 1) * count;
  if (start >= space.capacity)
    throw new Error(`Page is past the ${space.capacity} possible names`);
  const result = [];
  let index = 0;
  for (const word of space.names()) {
    if (index >= start) result.push(word);
    if (++index >= page * count) break;
  }
  return result;
}
