import { Dictionary } from "./dictionary";
export const VOWEL_SOUNDS = new Set(
  "AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split(" "),
);
export const CONSONANT_SOUNDS = new Set(
  "B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH".split(" "),
);
export const base = (p: string) => p.replace(/[012]+$/, "");
export const isVowel = (p: string) => VOWEL_SOUNDS.has(base(p));
export interface Pronunciation {
  phones: string[];
  source: string;
  notes: string[];
  alternatives: string[];
  boundaries: number[];
  structure: {
    syllables: number;
    opening: "vowel" | "consonant" | "cluster";
    ending: "open" | "closed";
  };
}
export function pronunciation(
  phones: string[],
  source: string,
  notes: string[] = [],
  alternatives: string[] = [],
  boundaries: number[] = [],
): Pronunciation {
  const first = phones.findIndex(isVowel);
  return {
    phones,
    source,
    notes,
    alternatives,
    boundaries,
    structure: {
      syllables: phones.filter(isVowel).length,
      opening: first === 0 ? "vowel" : first === 1 ? "consonant" : "cluster",
      ending: isVowel(phones.at(-1)!) ? "open" : "closed",
    },
  };
}
export function validatePhones(phones: string[]): string[] {
  if (phones.length < 1 || phones.length > 80)
    throw new Error("pronunciation needs 1–80 sound tokens");
  for (const p of phones) {
    if (
      !/^[A-Z]+[012]?$/.test(p) ||
      (!VOWEL_SOUNDS.has(base(p)) && !CONSONANT_SOUNDS.has(base(p)))
    )
      throw new Error(`unknown ARPABET sound '${p}'`);
    if (/\d$/.test(p) && !isVowel(p))
      throw new Error("stress digits are allowed only on vowels");
  }
  if (!phones.some(isVowel))
    throw new Error("pronunciation needs at least one vowel nucleus");
  return phones;
}
const spelling: Record<string, string> = {
  a: "AA",
  e: "EH",
  i: "IH",
  o: "OW",
  u: "UW",
  ee: "IY",
  oo: "UW",
  ai: "EY",
  ...Object.fromEntries(
    [...CONSONANT_SOUNDS]
      .filter((s) => !["HH", "JH", "NG"].includes(s))
      .map((s) => [s.toLowerCase(), s]),
  ),
  h: "HH",
  j: "JH",
};
export function spellingPhones(text: string): string[] {
  const result = [];
  while (text) {
    const token = [2, 1]
      .map((n) => text.slice(0, n))
      .find((t) => t in spelling);
    if (!token)
      throw new Error(
        `cannot read '${text}' in engine spelling; use ARPABET sounds`,
      );
    result.push(spelling[token]);
    text = text.slice(token.length);
  }
  return result;
}
let dictionary: Dictionary | null = null;
let pending: Promise<void> | null = null;
export function installDictionary(data: Uint8Array) {
  dictionary = new Dictionary(data);
}
let loader: (() => Promise<void>) | undefined;
export function setDictionaryLoader(load: () => Promise<void>) {
  loader = load;
}
export async function loadDictionary() {
  if (dictionary) return;
  if (!loader) throw new Error("No pronunciation dictionary loader configured");
  pending ??= loader();
  try {
    await pending;
  } catch (error) {
    pending = null;
    throw error;
  }
}
export async function readReference(
  word: string,
  reading?: string,
  phones?: string,
): Promise<Pronunciation> {
  if (!word.trim() || word.length > 80 || /[\p{C}\p{Zl}\p{Zp}]/u.test(word))
    throw new Error(
      "word must be a printable, nonempty label of at most 80 characters",
    );
  if (reading !== undefined && phones !== undefined)
    throw new Error("choose either a reading or ARPABET sounds");
  if (phones !== undefined)
    return pronunciation(
      validatePhones(phones.toUpperCase().trim().split(/\s+/)),
      "supplied ARPABET",
    );
  if (reading !== undefined) {
    reading = reading.trim().toLowerCase();
    if (!/^[a-z]+(?:[ -]+[a-z]+)*$/.test(reading) || reading.length > 120)
      throw new Error(
        "reading must use letters and optional spaces/hyphens between syllables",
      );
    const chunks = reading.split(/[ -]+/),
      sounds: string[] = [],
      boundaries: number[] = [],
      notes: string[] = [];
    if (chunks.length > 1) await loadDictionary();
    for (const chunk of chunks) {
      const choices = chunks.length > 1 ? dictionary!.get(chunk) || [] : [],
        single = choices.filter((p) => p.filter(isVowel).length === 1);
      let part: string[];
      if (single.length) {
        part = single[0].map(base);
        notes.push(
          `${chunk}: CMU syllable reading ${part.join(" ")} (stress not inferred)`,
        );
        if (single.length > 1)
          notes.push(
            `${chunk}: alternate syllable readings exist; use --phones to disambiguate`,
          );
      } else {
        part = spellingPhones(chunk);
        notes.push(
          `${chunk}: engine spelling ${part.join(" ")} (a=ah, e=eh, i=ih)`,
        );
      }
      if (chunks.length > 1 && part.filter(isVowel).length !== 1)
        throw new Error(
          `syllable '${chunk}' needs one vowel nucleus; separate vowels with a hyphen or use ARPABET`,
        );
      sounds.push(...part);
      boundaries.push(sounds.length);
    }
    return pronunciation(
      validatePhones(sounds),
      chunks.length > 1 ? "supplied syllables" : "supplied engine spelling",
      notes,
      [],
      boundaries.slice(0, -1),
    );
  }
  await loadDictionary();
  const choices = dictionary!.get(word.trim().toLowerCase());
  if (choices?.length)
    return pronunciation(
      validatePhones(choices[0]),
      "CMU dictionary (US English)",
      [
        "Dictionary reading is a suggestion; use --reading or --phones to override.",
      ],
      choices.slice(1).map((p) => p.join(" ")),
    );
  return pronunciation(
    validatePhones(spellingPhones(word.trim().toLowerCase())),
    "spelling assumption (not in dictionary)",
    [
      "No English pronunciation inferred; all letters are sounded. Supply --reading or --phones to confirm.",
    ],
  );
}
