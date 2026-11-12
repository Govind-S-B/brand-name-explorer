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
  const { id, mode, word, reading, phones, seed, count } = event.data;
  try {
    let result;
    if (mode === "inverter") {
      const parsed = parseSpelling(word),
        fits = fitProfiles(parsed);
      result = {
        parsed,
        phones: spellingPhoneSequence(parsed),
        fits: fits.slice(0, 10),
        note: "Integer dial-grid fits with neutral regularization, not recovered original settings.",
      };
    } else if (mode === "substitutions")
      result = suggest(await readReference(word, reading, phones), word, count);
    else result = await report(word, reading, phones, seed);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
