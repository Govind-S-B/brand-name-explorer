import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PythonRandom } from "../src/core/random";
import { MoodSpace, LegacySpace, generate } from "../src/core/generator";
const fixtures = JSON.parse(
  readFileSync(new URL("./parity.json", import.meta.url), "utf8"),
);
for (const [seed, expected] of Object.entries(fixtures.random) as [
  string,
  any,
][]) {
  test(`Python random seed ${seed}`, () => {
    let rng = new PythonRandom(seed);
    assert.deepEqual(
      Array.from({ length: 20 }, () => rng.random()),
      expected.random,
    );
    rng = new PythonRandom(seed);
    assert.deepEqual(
      Array.from({ length: 20 }, () => rng.randbelow(1000000007)),
      expected.randbelow,
    );
  });
}
for (const [i, fixture] of fixtures.generators.entries())
  test(`Mood parity ${i} ${JSON.stringify(fixture.settings)}`, () => {
    if (fixture.error) {
      assert.throws(() => new MoodSpace(fixture.settings));
      return;
    }
    const space = new MoodSpace(fixture.settings);
    assert.equal(space.capacity, fixture.capacity);
    assert.deepEqual(space.profile, fixture.profile);
    const names = [];
    for (const word of space.names()) {
      names.push(word);
      if (names.length >= fixture.names.length) break;
    }
    assert.deepEqual(names, fixture.names);
  });
for (const [i, fixture] of fixtures.legacy.entries())
  test(`Original style parity ${i}`, () => {
    const space = new LegacySpace({
      ...fixture.settings,
      length: fixture.settings.length ?? undefined,
    });
    assert.equal(space.capacity, fixture.capacity);
    const names = [];
    for (const word of space.names()) {
      names.push(word);
      if (names.length >= fixture.names.length) break;
    }
    assert.deepEqual(names, fixture.names);
  });
test("Pagination and exhaustive small space retain unique spellings", () => {
  const settings = { length: 3, syllables: 1, opening: "consonant" as const };
  const space = new MoodSpace(settings);
  const names = [...space.names()];
  assert.equal(names.length, space.capacity);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    [...generate(settings, 30), ...generate(settings, 30, 2)],
    generate(settings, 60),
  );
});
import { installDictionary, readReference } from "../src/core/pronunciation";
import { report, parseSpelling, fitProfiles } from "../src/core/inverter";
import { suggest } from "../src/core/substitutions";
installDictionary(
  JSON.parse(
    readFileSync(new URL("../src/data/cmudict.json", import.meta.url), "utf8"),
  ),
);
for (const [i, fixture] of fixtures.reports.entries())
  test(`Reverse report parity ${i} ${fixture.input.word}`, async () => {
    const { word, reading, phones } = fixture.input;
    assert.deepEqual(await report(word, reading, phones), fixture.result);
  });
for (const fixture of fixtures.fits)
  test(`Inverter grid parity ${fixture.word}`, () => {
    const parsed = parseSpelling(fixture.word);
    assert.deepEqual(parsed, fixture.parsed);
    const fits = fitProfiles(parsed);
    assert.equal(fits.length, 1331);
    fits.slice(0, 10).forEach(([score, dials], i) => {
      assert.deepEqual(dials, fixture.top[i][1]);
      assert.ok(Math.abs(score - fixture.top[i][0]) < 1e-10);
    });
  });
for (const [i, fixture] of fixtures.substitutions.entries())
  test(`Substitution parity ${i} ${fixture.input.word}`, async () => {
    const { word, reading, phones } = fixture.input;
    assert.deepEqual(
      suggest(await readReference(word, reading, phones), word, 3),
      fixture.result,
    );
  });
