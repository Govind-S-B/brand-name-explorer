import constants from "./constants.json";
import { PythonRandom } from "./random";
export { MOODS, DIALS, resolveProfile } from "./profile";
export type { Dial, Opening, Ending, Profile, Settings } from "./profile";
import {
  DIALS,
  resolveProfile,
  type Profile,
  type Settings,
  type Opening,
} from "./profile";
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
const soundVectors = /* @__PURE__ */ new Map(
  [...ONSETS, ...MIDDLES, ...CODAS].map(([text, sounds]) => [
    text,
    scales.map(
      (_, i) => sum(sounds.map((s) => effects[classes[s]][i])) / sounds.length,
    ),
  ]),
);
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
interface Token {
  text: string;
  weight: number;
}
export class Shape {
  private memo = new Map<number, [number, number]>();
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
    const key = depth * (this.length + 1) + left;
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
        const vector = soundVectors.get(text)!;
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
    const rng = new PythonRandom(this.seed);
    interface Removed {
      mass: number;
      count: number;
      children: Map<number, Removed>;
    }
    const node = (): Removed => ({ mass: 0, count: 0, children: new Map() });
    const roots = this.shapes.map(node);
    // Partition work is invariant across names; keep feasible transitions once.
    const transitions = this.shapes.map((shape) =>
      shape.slots.map((slot, depth) =>
        Array.from({ length: this.length + 1 }, (_, left) =>
          slot.flatMap((token, index) => {
            const [count, mass] = shape.partition(
              depth + 1,
              left - token.text.length,
            );
            return count ? [{ token, index, count, mass }] : [];
          }),
        ),
      ),
    );
    const weights: number[] = [];
    const available = (
      used: Removed | undefined,
      mass: number,
      count: number,
    ) =>
      used?.count === count
        ? 0
        : Math.max(mass - (used?.mass || 0), mass * 1e-14);
    const choose = (length: number) => {
      // Same compensated sum and subtraction order as the frozen reference.
      let total = 0,
        correction = 0,
        last = 0;
      for (let i = 0; i < length; i++) {
        const v = weights[i];
        if (!v) continue;
        last = i;
        const next = total + v;
        correction +=
          Math.abs(total) >= Math.abs(v) ? total - next + v : v - next + total;
        total = next;
      }
      let threshold = rng.random() * (total + correction);
      for (let i = 0; i < length; i++) {
        if (!weights[i]) continue;
        threshold -= weights[i];
        if (threshold < 0) return i;
      }
      return last;
    };
    for (let n = 0; n < this.capacity; n++) {
      this.shapes.forEach(
        (s, i) => (weights[i] = available(roots[i], s.prior, s.count)),
      );
      const route = choose(this.shapes.length),
        shape = this.shapes[route];
      let current = roots[route],
        left = this.length,
        prefixMass = shape.prior / shape.mass;
      const path = [current],
        parts: string[] = [];
      for (let depth = 0; depth < shape.slots.length; depth++) {
        const options = transitions[route][depth][left];
        options.forEach(
          ({ token, index, count, mass }, i) =>
            (weights[i] = available(
              current.children.get(index),
              prefixMass * token.weight * mass,
              count,
            )),
        );
        const { token, index } = options[choose(options.length)];
        let child = current.children.get(index);
        if (!child) {
          child = node();
          current.children.set(index, child);
        }
        current = child;
        path.push(current);
        parts.push(token.text);
        left -= token.text.length;
        prefixMass *= token.weight;
      }
      for (const p of path) {
        p.mass += prefixMass;
        p.count++;
      }
      yield capitalize(parts.join(""));
    }
  }
}

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
  const space = new MoodSpace(settings),
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
