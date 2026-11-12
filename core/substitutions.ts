import {
  CODAS,
  CONSONANT_PHONES,
  MIDDLES,
  MoodSpace,
  ONSETS,
  VOWEL_PHONES,
  capitalize,
} from "./generator";
import { base, isVowel, type Pronunciation } from "./pronunciation";
import { parseSpelling, spellingPhoneSequence } from "./inverter";
const manner: Record<string, number> = {};
[
  "B D G K P T",
  "DH F S SH TH V Z ZH",
  "CH JH",
  "M N NG",
  "L R",
  "W Y",
  "HH",
].forEach((group, i) => group.split(" ").forEach((p) => (manner[p] = i)));
const tokenPhones: Record<string, string[]> = {
  ...Object.fromEntries(
    [...ONSETS, ...MIDDLES, ...CODAS].map(([text, sounds]) => [
      text,
      sounds.map((s) => CONSONANT_PHONES[s]),
    ]),
  ),
  ...Object.fromEntries(Object.entries(VOWEL_PHONES).map(([t, p]) => [t, [p]])),
};
export function replacementCost(a: string, b: string) {
  return a === b
    ? 0
    : (isVowel(a) && isVowel(b)) ||
        (a in manner && b in manner && manner[a] === manner[b])
      ? 1
      : 2;
}
export function advance(
  row: number[],
  target: string[],
  phone: string,
): number[] {
  const next = [row[0] + 2];
  for (let i = 1; i <= target.length; i++)
    next.push(
      Math.min(
        next.at(-1)! + 2,
        row[i] + 2,
        row[i - 1] + replacementCost(target[i - 1], phone),
      ),
    );
  return next;
}
export function spellingDistance(a: string, b: string): number {
  let row = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (const char of b) {
    const next = [row[0] + 1];
    for (let i = 1; i <= a.length; i++)
      next.push(
        Math.min(
          next.at(-1)! + 1,
          row[i] + 1,
          row[i - 1] + Number(a[i - 1] !== char),
        ),
      );
    row = next;
  }
  return row.at(-1)!;
}
export function editDescription(source: string[], target: string[]): string[] {
  const rows = [Array.from({ length: source.length + 1 }, (_, i) => 2 * i)];
  for (const p of target) rows.push(advance(rows.at(-1)!, source, p));
  let i = source.length,
    j = target.length;
  const changes = [];
  while (i || j) {
    if (
      i &&
      j &&
      rows[j][i] ===
        rows[j - 1][i - 1] + replacementCost(source[i - 1], target[j - 1])
    ) {
      if (source[i - 1] !== target[j - 1])
        changes.push(`sound ${i}: ${source[i - 1]} → ${target[j - 1]}`);
      i--;
      j--;
    } else if (i && rows[j][i] === rows[j][i - 1] + 2) {
      changes.push(`remove sound ${i}: ${source[i - 1]}`);
      i--;
    } else {
      changes.push(`insert ${target[j - 1]} after original sound ${i}`);
      j--;
    }
  }
  return changes.reverse();
}
export function suggest(
  pronunciation: Pronunciation,
  reference: string,
  count: number,
) {
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new Error("substitutions must be from 1 to 20");
  const source = pronunciation.phones.map(base);
  reference = reference.trim().toLowerCase();
  const center = Math.min(14, Math.max(3, reference.length)),
    syllables = Math.min(5, Math.max(1, pronunciation.structure.syllables));
  const sizes = Array.from(
      { length: Math.min(14, center + 2) - Math.max(3, center - 2) + 1 },
      (_, i) => Math.max(3, center - 2) + i,
    ),
    syllableRange = Array.from(
      { length: Math.min(5, syllables + 1) - Math.max(1, syllables - 1) + 1 },
      (_, i) => Math.max(1, syllables - 1) + i,
    ),
    candidates = new Map<string, number>();
  for (const length of sizes)
    for (const size of syllableRange) {
      let space: MoodSpace;
      try {
        space = new MoodSpace({
          length,
          syllables: size,
          opening: "any",
          ending: "either",
          energy: 5,
          weight: 5,
          novelty: 5,
        });
      } catch {
        continue;
      }
      for (const shape of space.shapes) {
        let beam: [string, number[], number][] = [
          [
            "",
            Array.from({ length: source.length + 1 }, (_, i) => 2 * i),
            length,
          ],
        ];
        for (let depth = 0; depth < shape.slots.length; depth++) {
          const expanded: [string, number[], number][] = [];
          for (const [prefix, row, left] of beam)
            for (const token of shape.slots[depth]) {
              const rest = left - token.text.length;
              if (!shape.partition(depth + 1, rest)[0]) continue;
              let updated = row;
              for (const p of tokenPhones[token.text])
                updated = advance(updated, source, p);
              expanded.push([prefix + token.text, updated, rest]);
            }
          const final = depth === shape.slots.length - 1;
          expanded.sort(
            (a, b) =>
              (final ? a[1].at(-1)! : Math.min(...a[1])) -
                (final ? b[1].at(-1)! : Math.min(...b[1])) ||
              a[1].at(-1)! - b[1].at(-1)! ||
              (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
          );
          beam = expanded.slice(0, 48);
        }
        for (const [word, row] of beam)
          if (word !== reference) candidates.set(word, row.at(-1)!);
      }
    }
  const ordered = [...candidates.keys()].sort(
    (a, b) =>
      candidates.get(a)! - candidates.get(b)! ||
      spellingDistance(reference, a) - spellingDistance(reference, b) ||
      Math.abs(a.length - reference.length) -
        Math.abs(b.length - reference.length) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  const results = [],
    seen = new Set<string>();
  for (const word of ordered) {
    const parsed = parseSpelling(word),
      phones = spellingPhoneSequence(parsed),
      key = phones.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const original = { length: reference.length, ...pronunciation.structure };
    const structureChanges = Object.entries(original)
      .filter(([k, v]) => v !== parsed.structure[k as keyof typeof original])
      .map(
        ([k, v]) =>
          `${k}: ${v} → ${parsed.structure[k as keyof typeof original]}`,
      );
    results.push({
      word: capitalize(word),
      phones,
      sound_edit_cost: candidates.get(word)! / 2,
      edits: editDescription(source, phones),
      structure_changes: structureChanges,
      structure: parsed.structure,
    });
    if (results.length === count) break;
  }
  const relaxed = [];
  if (pronunciation.phones.some((p) => /\d$/.test(p)))
    relaxed.push("Stress is omitted; the generator cannot preserve it.");
  if (pronunciation.boundaries.length)
    relaxed.push("Explicit syllable boundary positions are omitted.");
  return {
    method: "bounded phoneme-edit beam search; not guaranteed globally nearest",
    searched_lengths: sizes,
    searched_syllables: syllableRange,
    beam_width: 48,
    relaxed,
    results,
  };
}
