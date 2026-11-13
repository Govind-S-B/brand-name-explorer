import constants from "./constants.json";
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
}
/** Parsed `--blend mood:fraction`, or undefined when no blend was requested. */
export function blendOf(settings: Settings) {
  if (!settings.blend) return;
  const parts = settings.blend.split(":"),
    amount = Number(parts[1]);
  if (
    parts.length !== 2 ||
    !parts[1].trim() ||
    !Object.hasOwn(MOODS, parts[0]) ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 1
  )
    throw new Error("Blend needs a known mood and a fraction from 0 to 1");
  return { mood: parts[0], amount };
}
export function resolveProfile(settings: Settings = {}): Profile {
  const { mood = "calm", ending } = settings;
  if (!Object.hasOwn(MOODS, mood)) throw new Error(`unknown mood: ${mood}`);
  const base = MOODS[mood as keyof typeof MOODS];
  const result: Profile = {
    energy: base.energy,
    weight: base.weight,
    novelty: base.novelty,
    ending: base.ending as Ending,
  };
  const blend = blendOf(settings);
  if (blend) {
    const other = MOODS[blend.mood as keyof typeof MOODS];
    for (const dial of DIALS)
      result[dial] =
        (1 - blend.amount) * result[dial] + blend.amount * other[dial];
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
