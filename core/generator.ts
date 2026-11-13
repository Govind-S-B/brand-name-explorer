import constants from "./constants.json";
import prior from "./prior.json";
import { PythonRandom } from "./random";
import {
  UNITS,
  rareLetters,
  runs,
  traits,
  trigramIndexes,
  type Position,
  type Unit,
} from "./grammar";
export { MOODS, DIALS, resolveProfile } from "./profile";
export type { Dial, Opening, Ending, Profile, Settings } from "./profile";
import {
  MOODS,
  resolveProfile,
  blendOf,
  type Profile,
  type Settings,
  type Opening,
} from "./profile";

/** Grammar/algorithm generation; bumped for structural changes. */
export const ENGINE_VERSION = 2;
/**
 * Identity of everything that decides a sequence: version plus a fingerprint
 * of the tuned constants and learned prior. Saved searches are keyed by it, so
 * retuning the engine never mixes old pages into new ones.
 */
export const ENGINE_ID = (() => {
  let hash = 0x811c9dc5;
  const text = JSON.stringify([constants, prior]);
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${ENGINE_VERSION}.${(hash >>> 0).toString(16)}`;
})();
export type Inventory = [string, string[]][];
const inventory = (p: Position): Inventory =>
  UNITS[p].map((u) => [u.text, u.sounds]);
export const ONSETS = inventory("o");
export const MIDDLES = inventory("m");
export const CODAS = inventory("c");
export const CONSONANT_PHONES = constants.consonant_phones as Record<
  string,
  string
>;
export const VOWEL_PHONES = constants.vowel_phones as Record<string, string>;
/** Nominal ARPABET reading of a token; vowel letters are read as plain qualities. */
export const unitPhones = (u: Unit): string[] =>
  u.sounds.map((s) => (u.vowel ? VOWEL_PHONES[s] : CONSONANT_PHONES[s]));
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

/** Mood character beyond the three dials. Design values, see docs/sound-dials.md. */
interface Character {
  sharp: number;
  flow: number;
  bright: number;
  bounce: number;
  rhythm: number;
  vowelStart: number;
  closed: number;
  repeat: number;
  budget: number;
  tags: Record<string, number>;
  endings: Record<string, number>;
  accent: Record<string, number>;
  /** Sounds that carry the mood; a name needs one, ideally in its first consonant. */
  signature: string[];
}
const NUMERIC = [
  "sharp",
  "flow",
  "bright",
  "bounce",
  "rhythm",
  "vowelStart",
  "closed",
  "repeat",
  "budget",
] as const;
const MAPS = ["tags", "endings", "accent"] as const;
const characters = constants.character as unknown as Record<string, Character>;
function resolveCharacter(settings: Settings): Character {
  const base = characters[settings.mood ?? "calm"],
    result: Character = {
      ...base,
      tags: { ...base.tags },
      endings: { ...base.endings },
      accent: { ...base.accent },
    },
    blend = blendOf(settings);
  if (blend) {
    const other = characters[blend.mood],
      mix = (a = 0, b = 0) => (1 - blend.amount) * a + blend.amount * b;
    for (const key of NUMERIC) result[key] = mix(base[key], other[key]);
    if (blend.amount > 0.5) result.signature = other.signature;
    else if (blend.amount > 0.25)
      result.signature = [...base.signature, ...other.signature];
    for (const map of MAPS)
      for (const key of new Set([
        ...Object.keys(base[map]),
        ...Object.keys(other[map]),
      ]))
        result[map][key] = mix(base[map][key], other[map][key]);
  }
  return result;
}

const sound = constants.sound as Record<string, number[]>;
const DIMENSIONS = constants.dims.length;
const priorTokens = prior.tokens as Record<string, Record<string, number>>;
const priorGlobal = prior.global as Record<string, number>;
/**
 * Teacher layer: how blind judges read mood and rate quality, distilled from
 * data/teacher-judgments.tsv by scripts/build-prior.ts. Index 0..6 are the
 * moods in TEACHER order, index 7 is quality.
 */
const teacher = prior.teacher as {
  quality: Record<string, number>;
  moods: Record<string, Record<string, number>>;
};
const TEACHER = Object.keys(teacher.moods);
const lessons = [...TEACHER.map((m) => teacher.moods[m]), teacher.quality];
const taught = (feature: string, amount = 1, into: Float64Array) => {
  for (let k = 0; k < lessons.length; k++)
    into[k] += (lessons[k][feature] ?? 0) * amount;
};
let trigram: Uint8Array | undefined;
function trigramBits(): Uint8Array {
  if (!trigram) {
    const binary = atob(prior.trigram);
    trigram = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) trigram[i] = binary.charCodeAt(i);
  }
  return trigram;
}
/** Mean letter-trigram surprise in bits; lower spellings look more familiar. */
export function spellingBits(text: string): number {
  const bits = trigramBits(),
    indexes = trigramIndexes(text);
  let total = 0;
  for (const i of indexes) total += bits[i];
  return total / 16 / indexes.length;
}
const blocked = new RegExp(constants.blocklist.join("|"));
/** Spellings an English reader would sound in more than one way. */
const AMBIGUOUS = /[cg][eiy]|qu[uy]|y.*y/;

export interface Token extends Unit {
  weight: number;
  /** Learned mood-independent desirability of this token in this slot. */
  base: number;
  /** Mood log-weight: dimension fit plus style tags, accents and endings. */
  mood: number;
  /** Teacher evidence this token adds for each mood, then quality. */
  taught: Float64Array;
}
export interface Scored {
  name: string;
  score: number;
  mood: number;
  prior: number;
  quality: number;
  /** Estimated probability that the .com is already registered. */
  taken: number;
}
/** Proposals examined per selection round. */
export const CHUNK = 256;
/**
 * Selection keeps the best candidates of each round until it expects this many
 * unregistered names among them (never fewer than MIN_KEEP nor more than
 * MAX_KEEP). Crowded corners (short, familiar-sounding names) therefore pass
 * more candidates; open ones (long or unusual names) are chosen strictly.
 */
export const EXPECT_FREE = 1.5;
export const MIN_KEEP = 2;
/** Kept names that must pass before a multi-letter consonant group may recur. */
export const SPACING = 12;
export const MAX_KEEP = 16;
const lengthOffsets = prior.lengths as Record<string, number>;
/** Registration log-odds offset for a name length, extrapolated past the sampled 6–8. */
function lengthOffset(length: number): number {
  const known = Object.keys(lengthOffsets).map(Number),
    low = Math.min(...known),
    high = Math.max(...known);
  if (length < low) return lengthOffsets[low] + 2.5 * (low - length);
  if (length > high) return lengthOffsets[high] - 1.5 * (length - high);
  return lengthOffsets[length];
}

export class Shape {
  private memo = new Map<number, [number, number]>();
  count: number;
  mass: number;
  constructor(
    public slots: Token[][],
    public length: number,
    public syllables: number,
    public prior: number,
  ) {
    [this.count, this.mass] = this.partition(0, length, syllables);
  }
  /** Count and weight of completions from a slot with letters and syllables left. */
  partition(depth: number, left: number, syllables: number): [number, number] {
    if (depth === this.slots.length)
      return left === 0 && syllables === 0 ? [1, 1] : [0, 0];
    if (left <= 0 || syllables < 0) return [0, 0];
    const key = (depth * 16 + left) * 8 + syllables;
    const saved = this.memo.get(key);
    if (saved) return saved;
    let count = 0,
      mass = 0;
    for (const token of this.slots[depth]) {
      const [n, w] = this.partition(
        depth + 1,
        left - token.text.length,
        syllables - token.syllables,
      );
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
  /** Distinct spellings the grammar can propose; selection keeps a fraction. */
  capacity = 0;
  profile: Profile;
  length: number;
  seed: string | number;
  opening: Opening;
  private character: Character;
  private target: number[];
  /**
   * Credit for looking more registered than "enough". Small where most such
   * names are taken (chasing them selects the leftovers), full for long names.
   */
  private tokens: Record<Position, Token[]>;
  private above: number;
  private lengthOffset: number;
  /** Teacher mood indexes and their shares (two entries when blending). */
  private reading: [number, number][];
  constructor(public settings: Settings = {}) {
    const {
      length = 7,
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
    this.above = Math.min(1, Math.max(0.35, 0.35 + 0.325 * (length - 6)));
    this.lengthOffset = lengthOffset(length);
    const blend = blendOf(settings),
      own = TEACHER.indexOf(settings.mood ?? "calm");
    this.reading = blend
      ? [
          [own, 1 - blend.amount],
          [TEACHER.indexOf(blend.mood), blend.amount],
        ]
      : [[own, 1]];
    this.length = length;
    this.seed = seed;
    this.opening = opening;
    const c = (this.character = resolveCharacter(settings));
    const target = (this.target = [
      this.profile.energy,
      this.profile.weight,
      this.profile.novelty,
      c.sharp,
      c.flow,
      c.bright,
      c.bounce,
    ].map((v) => (v - 5) / 5));
    // A dial moved away from the mood's own recipe is an explicit request, so
    // the offset gets its own, stronger gain than the recipe itself.
    const recipe = resolveProfile({ mood: settings.mood, blend: settings.blend }),
      offset = [
        this.profile.energy - recipe.energy,
        this.profile.weight - recipe.weight,
        this.profile.novelty - recipe.novelty,
      ].map((v) => v / 5);
    // Novelty loosens the pull toward familiar, much-registered patterns.
    const familiarity = 1 - 0.5 * Math.max(0, target[2]);
    const tokens = (position: Position): Token[] =>
      UNITS[position].map((u) => {
        let fit = 0,
          style = 0;
        for (let d = 0; d < DIMENSIONS; d++) {
          let mean = 0;
          for (const s of u.sounds) mean += sound[s][d];
          mean /= u.sounds.length;
          fit += target[d] * mean;
          if (d < 3) style += constants.dialGain * offset[d] * mean;
        }
        if (rareLetters(u.text)) style += constants.dialGain * 0.5 * offset[2];
        for (const tag of u.tags) style += c.tags[tag] ?? 0;
        if (!u.vowel && u.sounds.length > 1) style += c.tags.cluster ?? 0;
        if (rareLetters(u.text)) style += c.tags.rareLetter ?? 0;
        if (/^(th|ph|w)$/.test(u.text)) style += c.tags.soft ?? -0.8;
        for (const s of new Set(u.sounds)) style += c.accent[s] ?? 0;
        style += c.accent["=" + u.text] ?? 0;
        if (position === "f" || position === "c")
          style += c.endings[u.text] ?? 0;
        const base = priorTokens[position]?.[u.text] ?? -1,
          mood = constants.beta * fit + style,
          lesson = new Float64Array(lessons.length);
        for (const s of new Set(u.sounds)) taught("s:" + s, 1, lesson);
        if (position === "o" || position === "i")
          for (const s of u.sounds) taught("first:" + s, 1, lesson);
        if (position === "c" || position === "f")
          taught("end:" + u.text, 1, lesson);
        for (const tag of u.tags) taught("tag:" + tag, 1, lesson);
        if (!u.vowel && u.sounds.length > 1) taught("cluster", 1, lesson);
        return {
          ...u,
          base,
          mood,
          taught: lesson,
          weight: Math.exp(familiarity * base + mood),
        };
      });
    const all = Object.fromEntries(
      (["o", "m", "c", "i", "n", "f"] as Position[]).map((p) => [
        p,
        tokens(p),
      ]),
    ) as Record<Position, Token[]>;
    this.tokens = all;
    let onset = all.o;
    if (opening === "consonant")
      onset = onset.filter((t) => t.sounds.length === 1);
    if (opening === "cluster") onset = onset.filter((t) => t.sounds.length > 1);
    const ending = this.profile.ending;
    // Brand names add letters faster than syllables: about 2.7 syllables at
    // six letters and 3.3 at eight, shifted by the mood's rhythm.
    const rhythm = 1.1 + 0.27 * length + c.rhythm;
    for (const groups of [1, 2, 3, 4, 5])
      for (const starts of [false, true]) {
        if (
          (opening === "vowel" && starts) ||
          (["consonant", "cluster"].includes(opening) && !starts)
        )
          continue;
        for (const ends of [false, true]) {
          if (ending !== "either" && ends !== (ending === "closed")) continue;
          if (groups === 1 && !starts && !ends) continue;
          const slots: Token[][] = starts ? [onset] : [];
          for (let g = 0; g < groups; g++) {
            const last = g === groups - 1 && !ends,
              first = g === 0 && !starts;
            slots.push(last ? all.f : first ? all.i : all.n);
            if (g < groups - 1) slots.push(all.m);
          }
          if (ends) slots.push(all.c);
          for (let total = groups; total <= Math.min(5, groups * 2); total++) {
            if (syllables !== null && total !== syllables) continue;
            // Mood rhythm: syllables per letter, with hiatus shapes following
            // the mood's taste for vowel-on-vowel endings.
            const prior =
              Math.exp(-((total - rhythm) ** 2) / 0.605) *
              Math.exp(((c.tags.hi ?? 0) - 1) * (total - groups)) *
              (starts ? 1 - c.vowelStart : c.vowelStart) *
              (ending === "either" ? (ends ? c.closed : 1 - c.closed) : 1);
            const shape = new Shape(slots, length, total, prior);
            if (shape.count) this.shapes.push(shape);
          }
        }
      }
    this.capacity = sum(this.shapes.map((s) => s.count));
    if (!this.capacity)
      throw new Error(
        `no words fit opening=${opening}, syllables=${syllables || "auto"}, ending=${ending}, length=${length}; relax a structural or length constraint`,
      );
  }
  /** Every spelling once, in seeded weighted order (before selection). */
  *proposals(): Generator<Token[]> {
    const rng = new PythonRandom(this.seed);
    interface Removed {
      mass: number;
      count: number;
      /**
       * Created on first descent; most nodes are leaves or never revisited.
       * The first DENSE slots are revisited constantly and use a plain array
       * indexed by token position; deeper, sparser levels use a map.
       */
      dense?: (Removed | undefined)[];
      children?: Map<number, Removed>;
    }
    const DENSE = 3;
    const node = (): Removed => ({ mass: 0, count: 0 });
    const roots = this.shapes.map(node);
    const weights: number[] = [];
    // Feasible continuations per shape, slot and (letters, syllables) left;
    // filled on first use and reused for every later proposal.
    interface Option {
      token: Token;
      index: number;
      count: number;
      mass: number;
    }
    // `cumulative` lets a never-visited prefix (the common case below the
    // first slots) pick by binary search instead of re-weighing every option.
    interface Options {
      list: Option[];
      cumulative: Float64Array;
    }
    const transitions = this.shapes.map((shape) =>
      shape.slots.map(() => new Map<number, Options>()),
    );
    const available = (
      used: Removed | undefined,
      mass: number,
      count: number,
    ) =>
      used?.count === count
        ? 0
        : Math.max(mass - (used?.mass || 0), mass * 1e-14);
    const choose = (length: number) => {
      let total = 0,
        last = 0;
      for (let i = 0; i < length; i++)
        if (weights[i]) {
          total += weights[i];
          last = i;
        }
      let threshold = rng.random() * total;
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
        syllables = shape.syllables,
        prefix = shape.prior / shape.mass;
      const path = [current],
        parts: Token[] = [];
      for (let depth = 0; depth < shape.slots.length; depth++) {
        const key = left * 8 + syllables;
        let cached = transitions[route][depth].get(key);
        if (!cached) {
          const list: Option[] = [],
            slot = shape.slots[depth];
          for (let index = 0; index < slot.length; index++) {
            const token = slot[index],
              [count, mass] = shape.partition(
                depth + 1,
                left - token.text.length,
                syllables - token.syllables,
              );
            if (count) list.push({ token, index, count, mass });
          }
          const cumulative = new Float64Array(list.length);
          let running = 0;
          list.forEach((o, i) => {
            running += o.token.weight * o.mass;
            cumulative[i] = running;
          });
          transitions[route][depth].set(key, (cached = { list, cumulative }));
        }
        const options = cached.list;
        let pick: number;
        if (!current.children && !current.dense) {
          const { cumulative } = cached,
            threshold = rng.random() * cumulative[cumulative.length - 1];
          let low = 0,
            high = cumulative.length - 1;
          while (low < high) {
            const middle = (low + high) >> 1;
            if (cumulative[middle] > threshold) high = middle;
            else low = middle + 1;
          }
          pick = low;
        } else {
          const { dense, children } = current;
          for (let i = 0; i < options.length; i++) {
            const o = options[i];
            weights[i] = available(
              dense ? dense[o.index] : children!.get(o.index),
              prefix * o.token.weight * o.mass,
              o.count,
            );
          }
          pick = choose(options.length);
        }
        const { token, index } = options[pick];
        let child: Removed;
        if (depth < DENSE) {
          const dense = (current.dense ??= new Array(shape.slots[depth].length));
          child = dense[index] ??= node();
        } else {
          const children = (current.children ??= new Map());
          child = children.get(index) ?? node();
          children.set(index, child);
        }
        current = child;
        path.push(current);
        parts.push(token);
        left -= token.text.length;
        syllables -= token.syllables;
        prefix *= token.weight;
      }
      for (const p of path) {
        p.mass += prefix;
        p.count++;
      }
      yield parts;
    }
  }
  /** Judge an arbitrary spelling under this mood, or undefined if the grammar cannot spell it. */
  judge(word: string): Scored | undefined {
    const parts: Token[] = [];
    for (const { text, position } of runs(word.toLowerCase())) {
      const token = this.tokens[position].find((t) => t.text === text);
      if (!token) return;
      parts.push(token);
    }
    return this.score(parts);
  }
  /**
   * Whole-word judgement. Returns -Infinity for spellings that must never be
   * shown; otherwise mood fit plus the learned name prior.
   */
  score(parts: Token[]): Scored {
    const text = parts.map((p) => p.text).join(""),
      name = capitalize(text),
      c = this.character;
    const reject: Scored = {
      name,
      score: -Infinity,
      mood: 0,
      prior: 0,
      quality: 0,
      taken: 1,
    };
    if (AMBIGUOUS.test(text) || blocked.test(text)) return reject;
    const t = traits(parts);
    if (
      t.doubleAfterLong ||
      t.maxV >= 3 ||
      t.maxC >= 3
    )
      return reject;
    // Mood: position-weighted mean of token fits (first consonant, first
    // vowel and ending count extra) plus the single worst-fitting token.
    let total = 0,
      weight = 0,
      worst = 0,
      desirability = 0,
      seenVowel = false,
      seenConsonant = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let w = 1;
      if (p.vowel && !seenVowel) {
        w = 1.4;
        seenVowel = true;
      } else if (!p.vowel && !seenConsonant) {
        w = 1.6;
        seenConsonant = true;
      }
      if (i === parts.length - 1) w = Math.max(w, 1.3);
      total += w * p.mood;
      weight += w;
      worst = Math.min(worst, p.mood);
      desirability += p.base;
    }
    const rare = rareLetters(text);
    // Signature: the mood has to be audible, not merely not contradicted.
    let carried = 0,
      opens = false;
    for (let i = 0, first = true; i < parts.length; i++) {
      const p = parts[i];
      if (p.vowel) continue;
      for (const s of p.sounds)
        if (c.signature.includes(s)) {
          carried++;
          if (first) opens = true;
        }
      first = false;
    }
    const signature = carried ? (opens ? 0 : -0.7) : -2;
    // Reading clarity: y is only a clean vowel right after the opening
    // consonant or at the very end; i/e/u openings and -er endings blur stress.
    let unclear = 0;
    for (let i = 1; i < parts.length - 1; i++)
      if (parts[i].text === "y" && (i !== 1 || parts[0].vowel)) unclear += 1.5;
    if (parts[0].vowel && parts[0].text.length > 1) unclear += 1;
    else if (/^[ieu]/.test(text)) unclear += 0.5;
    if (parts.length > 4 && /[^aeiou]er$/.test(text)) unclear += 0.7;
    const echo = 0.7 * t.echoC + 1.0 * t.echoV + 1.5 * t.redup;
    const manner = t.manners === 1 ? -0.9 : t.manners === 3 ? 0.3 : 0;
    const mood =
      total / weight +
      constants.kappa * worst +
      (c.repeat - 1) * echo +
      manner +
      signature -
      unclear -
      1.6 * Math.max(0, t.complexity - c.budget - 0.5 * Math.max(0, this.length - 6)) -
      1.5 * Math.max(0, t.digraphs - 1) -
      0.9 * Math.max(0, rare - 2) -
      (t.sibilants >= 3 ? 1.2 : 0);
    // Prior: what registered names look like (see scripts/build-prior.ts).
    const bits = trigramBits();
    let sumBits = 0,
      worstBits = 0;
    const indexes = trigramIndexes(text);
    for (const i of indexes) {
      sumBits += bits[i];
      if (bits[i] > worstBits) worstBits = bits[i];
    }
    const g = priorGlobal;
    desirability +=
      (parts[0].vowel ? g.vowelStart : 0) +
      (parts[parts.length - 1].vowel ? g.open : 0) +
      g.complexity * t.complexity +
      g.echoC * t.echoC +
      g.echoV * t.echoV +
      g.redup * t.redup +
      (t.manners ? (g["manners" + t.manners] ?? 0) : 0) +
      g.inward * t.inward +
      g.rare * rare +
      g.uh * t.uh +
      g.bits * (sumBits / 16 / indexes.length - 4) +
      (g.worstBits * (worstBits / 16 - 7)) / 3;
    const familiarity = 1 - 0.25 * Math.max(0, this.target[2]);
    // Teacher: would a judge read the intended mood, and how good is the name?
    const lesson = new Float64Array(lessons.length);
    for (const p of parts)
      for (let k = 0; k < lesson.length; k++) lesson[k] += p.taught[k];
    if (parts[0].vowel) taught("vowelStart", 1, lesson);
    if (parts[parts.length - 1].vowel) taught("open", 1, lesson);
    taught("complexity", t.complexity, lesson);
    taught("echoC", t.echoC, lesson);
    taught("echoV", t.echoV, lesson);
    taught("redup", t.redup, lesson);
    if (t.manners) taught("manners" + t.manners, 1, lesson);
    taught("rare", rare, lesson);
    taught("uh", t.uh, lesson);
    taught("syllables", t.syllables - 2.5, lesson);
    taught("digraphs", t.digraphs, lesson);
    taught("bits", sumBits / 16 / indexes.length - 4, lesson);
    taught("length", text.length - 6, lesson);
    taught("bias", 1, lesson);
    let top = -Infinity;
    for (let k = 0; k < TEACHER.length; k++) top = Math.max(top, lesson[k]);
    let total2 = 0;
    for (let k = 0; k < TEACHER.length; k++) total2 += Math.exp(lesson[k] - top);
    const norm = top + Math.log(total2);
    let read = 0;
    for (const [k, share] of this.reading) read += share * (lesson[k] - norm);
    // Past "clearly reads as the mood" more certainty buys only sameness.
    const reading = constants.gamma * Math.min(read, Math.log(0.85)),
      quality = constants.tau * lesson[TEACHER.length];
    return {
      name,
      mood: mood + reading,
      quality,
      taken:
        1 / (1 + Math.exp(-(desirability + prior.bias + this.lengthOffset))),
      prior: desirability,
      // Only shortfalls count: chasing the most registered-looking spellings
      // would select exactly the names whose good versions are already taken.
      score:
        mood +
        reading +
        quality +
        constants.delta *
          familiarity *
          (Math.min(0, desirability - prior.enough) +
            this.above * Math.max(0, desirability - prior.enough)),
    };
  }
  /**
   * Selected names: the best of every CHUNK proposals (see EXPECT_FREE), in
   * proposal order.
   * A candidate that differs from a recently kept name by a single token
   * (Bralun after Dralun) is skipped so a page does not read as one template.
   */
  *names(): Generator<string> {
    let recent = new Set<string>(),
      older = new Set<string>();
    const neighbours = (parts: Token[]) =>
      parts.map((_, hole) =>
        parts.map((p, i) => (i === hole ? "*" : p.text)).join(" "),
      );
    // A distinctive consonant group (zzl, str, ndr) is cute once and a
    // template in bulk: each may recur only after SPACING other kept names.
    const lastUse = new Map<string, number>();
    let keptCount = 0;
    const distinctive = (parts: Token[]) =>
      parts.filter((p) => !p.vowel && p.text.length > 1).map((p) => p.text);
    let batch: { scored: Scored; parts: Token[]; index: number }[] = [],
      index = 0;
    const flush = () => {
      const kept: typeof batch = [];
      batch.sort(
        (a, b) => b.scored.score - a.scored.score || a.index - b.index,
      );
      let free = 0;
      for (const item of batch) {
        if (
          item.scored.score === -Infinity ||
          kept.length === MAX_KEEP ||
          (free >= EXPECT_FREE && kept.length >= MIN_KEEP)
        )
          break;
        const keys = neighbours(item.parts),
          groups = distinctive(item.parts);
        if (
          keys.some((k) => recent.has(k) || older.has(k)) ||
          groups.some((g) => keptCount - (lastUse.get(g) ?? -SPACING) < SPACING)
        )
          continue;
        for (const k of keys) recent.add(k);
        for (const g of groups) lastUse.set(g, keptCount);
        keptCount++;
        kept.push(item);
        free += 1 - item.scored.taken;
      }
      if (recent.size > 8192) {
        older = recent;
        recent = new Set();
      }
      batch = [];
      return kept.sort((a, b) => a.index - b.index).map((i) => i.scored.name);
    };
    for (const parts of this.proposals()) {
      batch.push({ scored: this.score(parts), parts, index: index++ });
      if (batch.length === CHUNK) yield* flush();
    }
    yield* flush();
  }
}

export function generate(
  settings: Settings = {},
  count = 200,
  page = 1,
): string[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(page * count)
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
  if (!result.length) throw new Error("Page is past the last selected name");
  return result;
}
