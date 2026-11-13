import { test } from "node:test";
import assert from "node:assert/strict";
import { MOODS, MoodSpace, generate, MAX_KEEP, CHUNK } from "../core/generator";
import { parseSpelling, rankMoods } from "../core/inverter";
import { rareLetters } from "../core/grammar";
import constants from "../core/constants.json";

const moods = Object.keys(MOODS);
const sample = (settings: object, count = 240) => generate(settings, count);
const share = (names: string[], pattern: RegExp) =>
  names.join("").match(pattern)!.length / names.join("").length;

test("Every mood yields unique, exact-length, parseable names free of blocked fragments", () => {
  const blocked = new RegExp(constants.blocklist.join("|"));
  for (const mood of moods)
    for (const length of [4, 6, 8, 11]) {
      const names = sample({ mood, length }, 120);
      assert.equal(new Set(names).size, names.length);
      for (const name of names) {
        assert.equal(name.length, length, name);
        assert.match(name, /^[A-Z][a-z]+$/);
        assert.doesNotMatch(name.toLowerCase(), blocked);
        assert.doesNotMatch(name.toLowerCase(), /[cg][eiy]/, name);
        assert.equal(parseSpelling(name).structure.length, length);
      }
    }
});
test("Structural constraints are never relaxed by mood preferences", () => {
  for (const mood of moods) {
    for (const name of sample({ mood, opening: "vowel", ending: "closed" }, 60)) {
      const { structure } = parseSpelling(name);
      assert.equal(structure.opening, "vowel", name);
      assert.equal(structure.ending, "closed", name);
    }
    for (const name of sample({ mood, opening: "cluster", ending: "open", length: 7 }, 60)) {
      const { structure } = parseSpelling(name);
      assert.equal(structure.opening, "cluster", name);
      assert.equal(structure.ending, "open", name);
    }
    for (const syllables of [2, 3])
      for (const name of sample({ mood, syllables, length: 7 }, 60))
        assert.equal(parseSpelling(name).structure.syllables, syllables, name);
  }
});
test("Selection is deterministic, seed-dependent and independent of page size", () => {
  assert.deepEqual(sample({ mood: "bold" }, 100), sample({ mood: "bold" }, 100));
  assert.notDeepEqual(
    sample({ mood: "bold", seed: 1 }, 40),
    sample({ mood: "bold", seed: 2 }, 40),
  );
  assert.deepEqual(
    [...generate({ mood: "airy" }, 30), ...generate({ mood: "airy" }, 30, 2)],
    generate({ mood: "airy" }, 60),
  );
  // Selection keeps at most MAX_KEEP names of every CHUNK proposals.
  const space = new MoodSpace({ length: 4, mood: "calm" });
  let kept = 0;
  for (const _ of space.names()) kept++;
  assert.ok(kept <= Math.ceil(space.capacity / CHUNK) * MAX_KEEP);
});
test("Dials move observable sound classes in the researched direction", () => {
  const at = (dial: string, value: number) =>
    sample({ mood: "lyrical", [dial]: value }, 400);
  // Energy: sonorants calm, voiceless stops and z excite.
  assert.ok(share(at("energy", 0), /[lmnw]/g) > share(at("energy", 10), /[lmnw]/g) + 0.03);
  assert.ok(share(at("energy", 10), /[ktpz]/g) > share(at("energy", 0), /[ktpz]/g) + 0.02);
  // Weight: voiced stops and back vowels are heavy; front vowels are light.
  assert.ok(share(at("weight", 10), /[bdgou]/g) > share(at("weight", 0), /[bdgou]/g) + 0.05);
  assert.ok(share(at("weight", 0), /[ie]/g) > share(at("weight", 10), /[ie]/g) + 0.03);
  // Novelty: unusual letters and voiced fricatives.
  const rare = (names: string[]) => rareLetters(names.join("").toLowerCase()) / names.length;
  assert.ok(rare(at("novelty", 10)) > rare(at("novelty", 0)) + 0.2);
});
test("Blending moves a recipe toward the other mood", () => {
  const stops = (names: string[]) => share(names, /[ktpbdgz]/g);
  const calm = stops(sample({ mood: "calm" })),
    half = stops(sample({ mood: "calm", blend: "bold:0.5" })),
    bold = stops(sample({ mood: "bold" }));
  assert.ok(calm < half && half < bold, `${calm} ${half} ${bold}`);
});
test("Each mood's names are recognised as that mood more often than any other", () => {
  for (const mood of moods) {
    const votes: Record<string, number> = {};
    for (const name of sample({ mood }, 120)) {
      const best = rankMoods(parseSpelling(name))[0][1];
      votes[best] = (votes[best] || 0) + 1;
    }
    const winner = Object.keys(votes).reduce((a, b) => (votes[a] >= votes[b] ? a : b));
    assert.equal(winner, mood, JSON.stringify(votes));
  }
});
