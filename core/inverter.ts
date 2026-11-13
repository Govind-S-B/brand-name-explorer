import {
  CONSONANT_PHONES,
  DIALS,
  MOODS,
  MoodSpace,
  VOWEL_PHONES,
  generate,
  sum,
  unitPhones,
  type Profile,
  type Settings,
  type Opening,
  type Ending,
} from "./generator";
import { UNITS, runs, unit, type Position, type Unit } from "./grammar";
import {
  base,
  isVowel,
  readReference,
  type Pronunciation,
} from "./pronunciation";
export interface Structure {
  length: number;
  syllables: number;
  opening: Opening;
  ending: Ending;
}
export interface Parsed {
  reading: string;
  parts: string[];
  units: Unit[];
  consonants: [string, string[]][];
  vowels: string[];
  structure: Structure;
}
const PLACES: Record<Position, string> = {
  o: "opening",
  m: "internal",
  c: "ending",
  i: "opening",
  n: "internal",
  f: "ending",
};
export function parseSpelling(reading: string): Parsed {
  reading = reading.trim().toLowerCase();
  if (!/^[a-z]{3,14}$/.test(reading))
    throw new Error("generator spelling must be 3–14 ASCII letters");
  const units = runs(reading).map(({ text, position }) => {
    const found = unit(position, text);
    if (!found)
      throw new Error(
        `unsupported ${PLACES[position]} ${"inf".includes(position) ? "vowel" : "consonant"} group '${text}'`,
      );
    return found;
  });
  const vowels = units.filter((u) => u.vowel),
    syllables = sum(vowels.map((u) => u.syllables));
  if (!vowels.length || syllables > 5 || (units.length === 1 && vowels.length))
    throw new Error(
      "reading needs 1–5 syllables separated by supported consonants",
    );
  return {
    reading,
    parts: units.map((u) => u.text),
    units,
    consonants: units.filter((u) => !u.vowel).map((u) => [u.text, u.sounds]),
    vowels: vowels.map((u) => u.text),
    structure: {
      length: reading.length,
      syllables,
      opening: units[0].vowel
        ? "vowel"
        : units[0].sounds.length === 1
          ? "consonant"
          : "cluster",
      ending: units.at(-1)!.vowel ? "open" : "closed",
    },
  };
}
/** Log probability of a spelling among proposals with its exact structure. */
export function logProbability(space: MoodSpace, parts: string[]): number {
  const length = sum(parts.map((p) => p.length));
  if (length !== space.length)
    throw new Error("reading does not match the supplied structure");
  for (const shape of space.shapes) {
    if (shape.slots.length !== parts.length) continue;
    let result = -Math.log(shape.mass),
      syllables = 0,
      fits = true;
    for (let i = 0; i < parts.length && fits; i++) {
      const token = shape.slots[i].find((t) => t.text === parts[i]);
      if (!token) fits = false;
      else {
        result += Math.log(token.weight);
        syllables += token.syllables;
      }
    }
    if (fits && syllables === shape.syllables) return result;
  }
  throw new Error("reading does not fit the supplied structure");
}
export type Dials = Pick<Profile, "energy" | "weight" | "novelty">;
/** A dial fit: score, dials, and the base mood they were fitted within. */
export type Fit = [number, Dials, string];
/** Moods ranked by how probable the spelling is under each recipe. */
export function rankMoods(parsed: Parsed): [number, string][] {
  return Object.keys(MOODS)
    .map((mood): [number, string] => [
      logProbability(
        new MoodSpace({ ...parsed.structure, mood }),
        parsed.parts,
      ),
      mood,
    ])
    .sort((a, b) => b[0] - a[0]);
}
export function fitProfiles(
  parsed: Parsed,
  mood = rankMoods(parsed)[0][1],
): Fit[] {
  const fits: Fit[] = [],
    recipe = MOODS[mood as keyof typeof MOODS];
  for (let energy = 0; energy <= 10; energy++)
    for (let weight = 0; weight <= 10; weight++)
      for (let novelty = 0; novelty <= 10; novelty++) {
        const dials = { energy, weight, novelty },
          space = new MoodSpace({ ...parsed.structure, mood, ...dials }),
          penalty =
            0.5 * sum(DIALS.map((d) => ((dials[d] - recipe[d]) / 5) ** 2));
        fits.push([logProbability(space, parsed.parts) - penalty, dials, mood]);
      }
  return fits.sort((a, b) => b[0] - a[0]);
}
export function spellingPhoneSequence(parsed: Parsed): string[] {
  return parsed.units.flatMap(unitPhones);
}
/** Dictionary phone → engine sound; several English vowels share one letter quality. */
const SOUND_OF: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CONSONANT_PHONES).map(([s, p]) => [p, s]),
  ),
  ...Object.fromEntries(Object.entries(VOWEL_PHONES).map(([s, p]) => [p, s])),
  AE: "a",
  AH: "a",
  AO: "o",
  EY: "e",
  IY: "i",
  UH: "u",
};
export function generatorProjection(
  pronunciation: Pronunciation,
  preferred?: string,
): { parsed: Parsed | null; gaps: string[] } {
  const phones = pronunciation.phones.map(base),
    gaps: string[] = [];
  for (const p of new Set(phones))
    if (!(p in SOUND_OF))
      gaps.push(`sound ${p} is absent from the generator sound inventory`);
  const sounds = phones.map((p) => SOUND_OF[p]);
  let spelling = "",
    index = 0;
  while (index < phones.length && !gaps.length) {
    const vowel = isVowel(phones[index]);
    let end = index;
    while (end < phones.length && isVowel(phones[end]) === vowel) end++;
    const position: Position = vowel
      ? end === phones.length && index > 0
        ? "f"
        : index === 0
          ? "i"
          : "n"
      : index === 0
        ? "o"
        : end === phones.length
          ? "c"
          : "m";
    const group = sounds.slice(index, end).join(" "),
      match = UNITS[position].find((u) => u.sounds.join(" ") === group);
    if (!match)
      gaps.push(
        vowel
          ? `adjacent vowel sounds ${phones.slice(index, end).join(" ")} have no ${PLACES[position]} vowel group in the current grammar`
          : `${PLACES[position]} group ${phones.slice(index, end).join(" ")} is outside the generator grammar`,
      );
    else spelling += match.text;
    index = end;
  }
  let parsed: Parsed | null = null;
  if (!gaps.length) {
    const same = (candidate: Parsed) =>
      candidate.units.flatMap((u) => u.sounds).join(" ") === sounds.join(" ");
    try {
      parsed = parseSpelling(spelling);
      if (preferred) {
        try {
          const candidate = parseSpelling(preferred);
          if (same(candidate)) parsed = candidate;
        } catch {
          /* use the representable projection */
        }
      }
    } catch (error) {
      gaps.push((error as Error).message);
    }
  }
  return { parsed, gaps };
}
export function invert(pronunciation: Pronunciation, reference: string) {
  reference = reference.trim().toLowerCase();
  const { parsed, gaps } = generatorProjection(pronunciation, reference),
    structure = { length: reference.length, ...pronunciation.structure };
  if (pronunciation.phones.some((p) => /\d$/.test(p)))
    gaps.push(
      "stress is specified by this reading but is not represented by the generator",
    );
  if (pronunciation.boundaries.length)
    gaps.push(
      "explicit syllable boundaries are not represented by the generator; only vowel-group count is",
    );
  if (parsed && parsed.reading !== reference)
    gaps.push(
      `this pronunciation renders as '${parsed.reading}' in the engine, not '${reference}'; alternate spelling is not supported`,
    );
  if (reference.length < 3 || reference.length > 14)
    gaps.push("reference spelling length is outside generator range 3–14");
  if (structure.syllables < 1 || structure.syllables > 5)
    gaps.push("vowel-group count is outside generator range 1–5");
  return {
    pronunciation,
    structure,
    gaps: [...new Set(gaps)],
    mode: gaps.length ? "gap: not representable" : "exact generator inverse",
    fits: gaps.length ? [] : fitProfiles(parsed!),
    generation: gaps.length ? null : parsed!.structure,
  };
}
export function closestRecipe(dials: Dials): string {
  return Object.keys(MOODS).reduce((best, mood) => {
    const distance = (m: string) =>
      sum(
        DIALS.map((d) => (MOODS[m as keyof typeof MOODS][d] - dials[d]) ** 2),
      );
    return distance(mood) < distance(best) ? mood : best;
  });
}
export function generatorCommand(
  structure: Structure,
  dials: Dials,
  seed: string | number,
  mood = closestRecipe(dials),
): string {
  return [
    "node",
    "dist/cli.mjs",
    "--mood",
    mood,
    ...Object.entries(dials).flatMap(([d, v]) => ["--" + d, String(v)]),
    ...["opening", "syllables", "ending", "length"].flatMap((k) => [
      "--" + k,
      String(structure[k as keyof Structure]),
    ]),
    "--seed",
    String(seed),
    "--no-check-com",
    "--count",
    "20",
    "--page",
    "1",
  ].join(" ");
}
export async function report(
  word: string,
  reading?: string,
  phones?: string,
  seed: string | number = 42,
) {
  const pronunciation = await readReference(word, reading, phones),
    inverse = invert(pronunciation, word);
  const result = {
    reference: word,
    status: inverse.gaps.length ? "gap" : "fit",
    source: pronunciation.source,
    phones: pronunciation.phones,
    syllable_boundaries: pronunciation.boundaries,
    reading_notes: pronunciation.notes,
    alternatives: pronunciation.alternatives,
    structure: inverse.structure,
    gaps: inverse.gaps,
    candidates: [] as {
      dials: Dials;
      nearest_recipe: string;
      fit_gap: number;
      samples: string[];
      command: string;
    }[],
    ranges: {} as Record<string, [number, number]>,
  };
  if (inverse.gaps.length) return result;
  const best = inverse.fits[0][0],
    nearby = inverse.fits
      .filter(([score]) => best - score <= 0.1)
      .map(([, d]) => d);
  for (const d of DIALS)
    result.ranges[d] = [
      Math.min(...nearby.map((p) => p[d])),
      Math.max(...nearby.map((p) => p[d])),
    ];
  for (const [score, dials, mood] of inverse.fits.slice(0, 3)) {
    result.candidates.push({
      dials,
      nearest_recipe: mood,
      fit_gap: Number((best - score).toFixed(6)),
      samples: generate(
        { ...inverse.generation, mood, ...dials, seed } as Settings,
        5,
      ),
      command: generatorCommand(inverse.generation!, dials, seed, mood),
    });
  }
  return result;
}
