/**
 * Refresh the engine regression snapshots in tests/parity.json after a
 * deliberate engine change (new constants, prior or grammar). Inputs stay
 * fixed; outputs are re-recorded from the current engine. The PRNG and
 * pronunciation fixtures are independent of the engine and are left untouched.
 * Usage: npx tsx scripts/update-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ENGINE_ID, MoodSpace, generate } from "../core/generator";
import { installDictionary, readReference } from "../core/pronunciation";
import { report, parseSpelling, fitProfiles } from "../core/inverter";
import { suggest } from "../core/substitutions";

const path = new URL("../tests/parity.json", import.meta.url);
const fixtures = JSON.parse(readFileSync(path, "utf8"));
installDictionary(readFileSync(new URL("../data/cmudict.bin", import.meta.url)));
const attempt = async <T>(work: () => T | Promise<T>) => {
  try {
    return { result: await work() };
  } catch (error) {
    return { error: (error as Error).message };
  }
};
for (const fixture of fixtures.generators) {
  const count = fixture.count ?? (fixture.names?.length || 60);
  for (const key of ["capacity", "profile", "names", "error"]) delete fixture[key];
  fixture.count = count;
  try {
    const space = new MoodSpace(fixture.settings),
      names: string[] = [];
    for (const word of space.names()) {
      names.push(word);
      if (names.length >= count) break;
    }
    Object.assign(fixture, { capacity: space.capacity, profile: space.profile, names });
  } catch (error) {
    fixture.error = (error as Error).message;
  }
}
for (const fixture of fixtures.reports) {
  const { word, reading, phones } = fixture.input;
  delete fixture.result;
  delete fixture.error;
  Object.assign(fixture, await attempt(() => report(word, reading, phones)));
}
for (const fixture of fixtures.fits) {
  for (const key of ["parsed", "top", "error"]) delete fixture[key];
  try {
    const parsed = parseSpelling(fixture.word);
    Object.assign(fixture, { parsed, top: fitProfiles(parsed).slice(0, 10) });
  } catch (error) {
    fixture.error = (error as Error).message;
  }
}
for (const fixture of fixtures.substitutions) {
  const { word, reading, phones } = fixture.input;
  delete fixture.result;
  delete fixture.error;
  Object.assign(
    fixture,
    await attempt(async () => suggest(await readReference(word, reading, phones), word, 3)),
  );
}
for (const fixture of fixtures.longGenerators)
  fixture.names = generate(fixture.settings, fixture.names.length);
fixtures.provenance = {
  engine: ENGINE_ID,
  note: "generators, reports, fits, substitutions and longGenerators are regression snapshots of the TypeScript engine (scripts/update-fixtures.ts). random and pronunciations remain the independently captured reference fixtures.",
};
writeFileSync(path, JSON.stringify(fixtures) + "\n");
console.log("fixtures refreshed for engine", ENGINE_ID);
