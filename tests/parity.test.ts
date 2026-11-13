import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PythonRandom } from "../core/random";
import { MoodSpace, generate } from "../core/generator";
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
  });
}
for (const [i, fixture] of fixtures.generators.entries())
  test(`Mood snapshot ${i} ${JSON.stringify(fixture.settings)}`, () => {
    if (fixture.error) {
      assert.throws(() => new MoodSpace(fixture.settings), {
        message: fixture.error,
      });
      return;
    }
    const space = new MoodSpace(fixture.settings);
    assert.equal(space.capacity, fixture.capacity);
    assert.deepEqual(space.profile, fixture.profile);
    const names = [];
    for (const word of space.names()) {
      names.push(word);
      if (names.length >= fixture.count) break;
    }
    assert.deepEqual(names, fixture.names);
    assert.equal(new Set(names).size, names.length);
  });
test("Pagination and exhaustive small space retain unique spellings", () => {
  const settings = { length: 3, syllables: 1, opening: "consonant" as const };
  const space = new MoodSpace(settings);
  const names = [...space.names()],
    proposals = [...space.proposals()].map((p) => p.map((t) => t.text).join(""));
  assert.equal(proposals.length, space.capacity);
  assert.equal(new Set(proposals).size, proposals.length);
  assert.ok(names.length > 0 && names.length <= space.capacity);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    [...generate(settings, 5), ...generate(settings, 5, 2)],
    generate(settings, 10),
  );
});
import { installDictionary, readReference } from "../core/pronunciation";
import { report, parseSpelling, fitProfiles } from "../core/inverter";
import { suggest } from "../core/substitutions";
installDictionary(
  readFileSync(new URL("../data/cmudict.bin", import.meta.url)),
);
// Snapshots survive a JSON round trip, so compare in that form.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
for (const [i, fixture] of fixtures.reports.entries())
  test(`Reverse report snapshot ${i} ${fixture.input.word}`, async () => {
    const { word, reading, phones } = fixture.input;
    if (fixture.error)
      await assert.rejects(report(word, reading, phones), {
        message: fixture.error,
      });
    else
      assert.deepEqual(plain(await report(word, reading, phones)), fixture.result);
  });
for (const fixture of fixtures.fits)
  test(`Inverter grid snapshot ${fixture.word}`, () => {
    if (fixture.error) {
      assert.throws(() => parseSpelling(fixture.word), {
        message: fixture.error,
      });
      return;
    }
    const parsed = parseSpelling(fixture.word);
    assert.deepEqual(plain(parsed), fixture.parsed);
    const fits = fitProfiles(parsed);
    assert.equal(fits.length, 1331);
    fits.slice(0, 10).forEach(([score, dials, mood], i) => {
      assert.deepEqual(dials, fixture.top[i][1]);
      assert.equal(mood, fixture.top[i][2]);
      assert.ok(Math.abs(score - fixture.top[i][0]) < 1e-9);
    });
  });
for (const [i, fixture] of fixtures.substitutions.entries())
  test(`Substitution snapshot ${i} ${fixture.input.word}`, async () => {
    const { word, reading, phones } = fixture.input,
      run = async () =>
        suggest(await readReference(word, reading, phones), word, 3);
    if (fixture.error) await assert.rejects(run(), { message: fixture.error });
    else assert.deepEqual(plain(await run()), fixture.result);
  });

for (const fixture of fixtures.pronunciations)
  test(`Pronunciation ${JSON.stringify(fixture.input)}`, async () => {
    const { word, reading, phones } = fixture.input;
    assert.deepEqual(
      await readReference(word, reading, phones),
      fixture.result,
    );
  });
for (const fixture of fixtures.longGenerators)
  test(`Long sequence ${JSON.stringify(fixture.settings)}`, () =>
    assert.deepEqual(
      generate(fixture.settings, fixture.names.length),
      fixture.names,
    ));
