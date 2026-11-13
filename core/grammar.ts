/**
 * Spelling grammar shared by the generator, its inverse and the prior builder.
 * A word is alternating runs of consonant letters and vowel letters (a e i o u
 * y; the u of "qu" stays with its q). Every run is exactly one token, so each
 * spelling has a single decomposition.
 */
import constants from "./constants.json";
/** Slot positions: o onset, m medial, c coda; i initial vowel, n inner vowel, f final vowel. */
export type Position = "o" | "m" | "c" | "i" | "n" | "f";
export interface Unit {
  text: string;
  /** Abstract sounds: consonants (l m n r w f s sh h th v z p t k ch b d g j) or vowel qualities (a e i o u). */
  sounds: string[];
  syllables: number;
  vowel: boolean;
  tags: string[];
}
const expand = (rows: string[][], vowel: boolean) => {
  const result: Record<string, Unit[]> = {};
  for (const [positions, list, tags = ""] of rows)
    for (const item of list.split(" ")) {
      const [text, spec] = item.split(":"),
        sounds = (spec || text).split("+");
      for (const position of positions)
        (result[position] ??= []).push({
          text,
          sounds,
          syllables: vowel ? sounds.length : 0,
          vowel,
          tags: tags ? tags.split(" ") : [],
        });
    }
  return result;
};
export const UNITS = {
  ...expand(constants.consonants, false),
  ...expand(constants.vowels, true),
} as Record<Position, Unit[]>;
const lookup = Object.fromEntries(
  Object.entries(UNITS).map(([p, units]) => [
    p,
    new Map(units.map((u) => [u.text, u])),
  ]),
) as Record<Position, Map<string, Unit>>;
export const unit = (position: Position, text: string) =>
  lookup[position].get(text);
const VOWEL = /^[aeiouy]/;
/** Split a lowercase spelling into letter runs with their slot positions. */
export function runs(word: string): { text: string; position: Position }[] {
  const parts = word
    .replace(/qu/g, "Q")
    .match(/[aeiouy]+|[^aeiouy]+/g)!
    .map((r) => r.replace(/Q/g, "qu"));
  return parts.map((text, k) => {
    const first = k === 0,
      last = k === parts.length - 1;
    return {
      text,
      position: (VOWEL.test(text)
        ? last && !first
          ? "f"
          : first
            ? "i"
            : "n"
        : first
          ? "o"
          : last
            ? "c"
            : "m") as Position,
    };
  });
}
const MANNER: Record<string, string> = {};
[
  "m n",
  "l r",
  "w",
  "f s sh h th v z",
  "p t k b d g",
  "ch j",
].forEach((group, i) => group.split(" ").forEach((s) => (MANNER[s] = i + "")));
const PLACE: Record<string, number> = {};
["p b m f v w", "t d n s z l r sh ch j th", "k g h"].forEach((group, i) =>
  group.split(" ").forEach((s) => (PLACE[s] = i)),
);
/** Letters that look unusual on the page. */
export const rareLetters = (text: string) =>
  text.match(/[zxvkjqy]/g)?.length ?? 0;
/** Whole-word structure counts used by the learned prior and the mood scorer. */
export interface Traits {
  complexity: number;
  echoC: number;
  echoV: number;
  maxC: number;
  maxV: number;
  redup: number;
  manners: number; // 0 when fewer than three consonant sounds
  inward: number;
  uh: number;
  sibilants: number;
  doubleAfterLong: boolean;
  /** Multi-letter vowel groups (digraphs and hiatus). */
  digraphs: number;
  syllables: number;
}
export function traits(parts: Unit[]): Traits {
  const cons = new Map<string, number>(),
    vows = new Map<string, number>();
  let complexity = 0,
    redup = 0,
    uh = 0,
    sounds = 0,
    sibilants = 0,
    inward = 0,
    place = -1,
    syllables = 0,
    digraphs = 0,
    doubleAfterLong = false;
  const manners = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i],
      next = parts[i + 1],
      prev = parts[i - 1];
    if (p.vowel) {
      syllables += p.syllables;
      vows.set(p.text, (vows.get(p.text) || 0) + 1);
      if (p.text.length > 1) digraphs++;
      if (p.text.length > 1)
        complexity += p.tags.includes("hi") && !next ? 0.5 : p.tags.includes("him") ? 1.5 : 1;
      // A lone u in a closed syllable reads as "uh"; -um and -us are exempt.
      if (
        p.text === "u" &&
        next &&
        (next.sounds.length > 1 ||
          next.tags.includes("dbl") ||
          (i === parts.length - 2 && !/^[ms]$/.test(next.text)))
      )
        uh++;
    } else {
      const dbl = p.tags.includes("dbl");
      complexity +=
        p.sounds.length >= 3 ? 2 : p.sounds.length === 2 ? 1 : dbl ? 1 : p.text.length > 1 ? 0.5 : 0;
      if (dbl && (!prev || prev.text.length !== 1 || prev.text === "y"))
        doubleAfterLong = true;
      for (const s of p.sounds) {
        cons.set(s, (cons.get(s) || 0) + 1);
        manners.add(MANNER[s]);
        sounds++;
        if ("s z sh ch j".split(" ").includes(s)) sibilants++;
      }
      const here = PLACE[p.sounds[0]];
      if (place >= 0) inward += Math.sign(here - place);
      place = here;
      if (
        next &&
        parts[i + 2]?.text === p.text &&
        parts[i + 3]?.text === next.text
      )
        redup++;
    }
  }
  let echoC = 0,
    echoV = 0,
    maxC = 0,
    maxV = 0;
  for (const n of cons.values()) {
    echoC += n - 1;
    maxC = Math.max(maxC, n);
  }
  for (const n of vows.values()) {
    echoV += n - 1;
    maxV = Math.max(maxV, n);
  }
  return {
    complexity,
    echoC,
    echoV,
    maxC,
    maxV,
    redup,
    manners: sounds >= 3 ? Math.min(3, manners.size) : 0,
    inward: Math.sign(inward),
    uh,
    sibilants,
    doubleAfterLong,
    digraphs,
    syllables,
  };
}
/** Letter-trigram index with ^ and $ boundaries (28 symbols). */
const letter = (c: string) =>
  c === "^" ? 0 : c === "$" ? 27 : c.charCodeAt(0) - 96;
export function trigramIndexes(word: string): number[] {
  const s = "^^" + word + "$",
    result = [];
  for (let i = 2; i < s.length; i++)
    result.push(
      (letter(s[i - 2]) * 28 + letter(s[i - 1])) * 28 + letter(s[i]),
    );
  return result;
}
