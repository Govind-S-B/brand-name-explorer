import {
  report,
  fitProfiles,
  parseSpelling,
  spellingPhoneSequence,
} from "../../core/inverter";
import {
  readReference,
  setDictionaryLoader,
  installDictionary,
} from "../../core/pronunciation";
import { suggest } from "../../core/substitutions";
setDictionaryLoader(async () => {
  const response = await fetch(
    new URL("../../data/cmudict.bin", import.meta.url),
  );
  if (!response.ok)
    throw new Error(
      "The pronunciation dictionary is not available offline yet. Supply ARPABET or an unsegmented engine reading.",
    );
  installDictionary(new Uint8Array(await response.arrayBuffer()));
});
self.onmessage = async (event: MessageEvent) => {
  const { id, mode, word, reading, phones, seed, count, boundaries } =
    event.data;
  try {
    let result;
    if (mode === "inverter") {
      result = spellingFit(word);
    } else if (mode === "name") {
      if (phones) {
        result = await report(word, undefined, phones, seed);
        if (boundaries?.length) {
          result.candidates = [];
          result.gaps.push(
            "Explicit syllable boundaries are not represented by the generator; only vowel-group count is.",
          );
        }
      } else {
        try {
          result = spellingFit(word);
        } catch {
          result = await report(word, undefined, undefined, seed);
        }
      }
    } else if (mode === "substitutions")
      result = suggest(await readReference(word, reading, phones), word, count);
    else result = await report(word, reading, phones, seed);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};

function spellingFit(word: string) {
  const parsed = parseSpelling(word),
    fits = fitProfiles(parsed);
  return {
    parsed,
    phones: spellingPhoneSequence(parsed),
    fits: fits.slice(0, 10),
    nearest_recipe: fits[0][2],
    note: "Most probable mood, then integer dial-grid fits regularized toward that mood's recipe; not recovered original settings.",
  };
}
