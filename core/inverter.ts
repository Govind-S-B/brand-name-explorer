import {
  CODAS,
  CONSONANT_PHONES,
  DIALS,
  MIDDLES,
  MOODS,
  MoodSpace,
  ONSETS,
  VOWELS,
  VOWEL_PHONES,
  generate,
  sum,
  type Profile,
  type Settings,
  type Opening,
  type Ending,
} from "./generator";
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
  consonants: [string, string[]][];
  vowels: string[];
  structure: Structure;
}
export function parseSpelling(reading: string): Parsed {
  reading = reading.trim().toLowerCase();
  if (!/^[a-z]{3,14}$/.test(reading))
    throw new Error("generator spelling must be 3–14 ASCII letters");
  const parts = reading.match(/[aeiou]+|[^aeiou]+/g)!,
    consonants: [string, string[]][] = [],
    vowels: string[] = [];
  for (const [index, part] of parts.entries()) {
    if ("aeiou".includes(part[0])) {
      if (!VOWELS.includes(part))
        throw new Error(
          `unsupported vowel group '${part}'; allowed: ${VOWELS.join(", ")}`,
        );
      vowels.push(part);
    } else {
      const [location, inventory] =
        index === 0
          ? ["opening", ONSETS]
          : index === parts.length - 1
            ? ["ending", CODAS]
            : ["internal", MIDDLES];
      const phones = (inventory as typeof ONSETS).find(
        ([t]) => t === part,
      )?.[1];
      if (!phones)
        throw new Error(`unsupported ${location} consonant group '${part}'`);
      consonants.push([part, phones]);
    }
  }
  if (vowels.length < 1 || vowels.length > 5)
    throw new Error(
      "reading needs 1–5 vowel groups separated by supported consonants",
    );
  return {
    reading,
    parts,
    consonants,
    vowels,
    structure: {
      length: reading.length,
      syllables: vowels.length,
      opening: "aeiou".includes(parts[0][0])
        ? "vowel"
        : ONSETS.find(([t]) => t === parts[0])![1].length === 1
          ? "consonant"
          : "cluster",
      ending: "aeiou".includes(parts.at(-1)![0]) ? "open" : "closed",
    },
  };
}
export function logProbability(space: MoodSpace, parts: string[]): number {
  if (space.shapes.length !== 1)
    throw new Error(
      "reverse scoring requires an exact opening, syllables, and ending",
    );
  const shape = space.shapes[0];
  if (
    parts.length !== shape.slots.length ||
    sum(parts.map((p) => p.length)) !== space.length
  )
    throw new Error("reading does not match the supplied structure");
  let result = -Math.log(shape.mass);
  for (let i = 0; i < parts.length; i++) {
    const token = shape.slots[i].find((t) => t.text === parts[i]);
    if (!token)
      throw new Error(`'${parts[i]}' does not fit the supplied structure`);
    result += Math.log(token.weight);
  }
  return result;
}
export type Dials = Pick<Profile, "energy" | "weight" | "novelty">;
export type Fit = [number, Dials];
export function fitProfiles(parsed: Parsed): Fit[] {
  const fits: Fit[] = [];
  for (let energy = 0; energy <= 10; energy++)
    for (let weight = 0; weight <= 10; weight++)
      for (let novelty = 0; novelty <= 10; novelty++) {
        const dials = { energy, weight, novelty },
          space = new MoodSpace({ ...parsed.structure, ...dials }),
          penalty =
            0.5 * sum([energy, weight, novelty].map((v) => ((v - 5) / 5) ** 2));
        fits.push([logProbability(space, parsed.parts) - penalty, dials]);
      }
  return fits.sort((a, b) => b[0] - a[0]);
}
export function spellingPhoneSequence(parsed: Parsed): string[] {
  const consonants = Object.fromEntries(parsed.consonants);
  return parsed.parts.flatMap((p) =>
    p in VOWEL_PHONES
      ? [VOWEL_PHONES[p]]
      : consonants[p].map((s) => CONSONANT_PHONES[s]),
  );
}
export function generatorProjection(
  pronunciation: Pronunciation,
  preferred?: string,
): { parsed: Parsed | null; gaps: string[] } {
  const phones = pronunciation.phones.map(base),
    mapping = {
      ...Object.fromEntries(
        Object.entries(CONSONANT_PHONES).map(([s, p]) => [p, s]),
      ),
      ...Object.fromEntries(
        Object.entries(VOWEL_PHONES).map(([s, p]) => [p, s]),
      ),
      UW: "u",
    } as Record<string, string>;
  const gaps: string[] = [];
  for (const p of new Set(phones))
    if (!(p in mapping))
      gaps.push(`sound ${p} is absent from the generator sound inventory`);
  if (phones.some((p, i) => i > 0 && isVowel(p) && isVowel(phones[i - 1])))
    gaps.push(
      "adjacent vowel nuclei (hiatus) require a consonant between them in the current grammar",
    );
  let index = 0;
  while (index < phones.length) {
    if (isVowel(phones[index])) {
      index++;
      continue;
    }
    let end = index;
    while (end < phones.length && !isVowel(phones[end])) end++;
    const [label, inventory] =
      index === 0
        ? ["opening", ONSETS]
        : end === phones.length
          ? ["ending", CODAS]
          : ["internal", MIDDLES];
    const group = phones.slice(index, end).join(" ");
    if (
      !(inventory as typeof ONSETS).some(
        ([, sounds]) =>
          sounds.map((s) => CONSONANT_PHONES[s]).join(" ") === group,
      )
    )
      gaps.push(`${label} group ${group} is outside the generator grammar`);
    index = end;
  }
  let parsed: Parsed | null = null;
  if (!gaps.length) {
    let spelling = phones.map((p) => mapping[p]).join("");
    if (preferred) {
      try {
        const candidate = parseSpelling(preferred);
        if (spellingPhoneSequence(candidate).join(" ") === phones.join(" "))
          spelling = preferred;
      } catch {
        /* use the representable projection */
      }
    }
    try {
      parsed = parseSpelling(spelling);
      if (spellingPhoneSequence(parsed).join(" ") !== phones.join(" ")) {
        gaps.push(
          "spelling merges distinct sound tokens in the current grammar",
        );
        parsed = null;
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
): string {
  return [
    "node",
    "dist/cli.mjs",
    "--mood",
    closestRecipe(dials),
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
  for (const [score, dials] of inverse.fits.slice(0, 3)) {
    result.candidates.push({
      dials,
      nearest_recipe: closestRecipe(dials),
      fit_gap: Number((best - score).toFixed(6)),
      samples: generate(
        { ...inverse.generation, ...dials, seed } as Settings,
        5,
      ),
      command: generatorCommand(inverse.generation!, dials, seed),
    });
  }
  return result;
}
