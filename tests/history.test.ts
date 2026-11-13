import { test } from "node:test";
import assert from "node:assert/strict";
import { FRONT, MOODS } from "../core/profile";
import {
  addHistory,
  readHistory,
  validEntry,
  freshSeed,
  freshMood,
  readAppSettings,
  type HistoryEntry,
} from "../web/src/history";

const entry: HistoryEntry = {
  id: "original",
  at: 1700000000000,
  source: "Opened page",
  fresh: false,
  controls: {
    mood: "calm",
    explicit: "energy,weight,novelty",
    seed: "12345678901234567890",
    length: "6",
    page: "3",
    energy: "1",
    weight: "3",
    novelty: "2",
    "blend-amount": "0.3",
    "rdap-concurrency": "6",
    "rdap-rate": "30",
    "dns-concurrency": "12",
    "dns-rate": "40",
    "dns-timeout": "2000",
    "hedge-delay": "250",
    blend: "playful",
    syllables: "",
    opening: "any",
    ending: "",
    count: "20",
    "check-domains": true,
    "filter-available": true,
    "use-dns": true,
  },
};
test("History preserves exact controls and custom Reverse readings through storage", () => {
  const reverse = {
    ...entry,
    reverse: {
      word: "Open AI",
      mode: "phones" as const,
      value: "OW P AH N EY AY",
    },
  };
  assert.ok(validEntry(entry));
  assert.deepEqual(readHistory(JSON.stringify([entry, reverse])), [
    entry,
    reverse,
  ]);
  assert.equal(
    readHistory(JSON.stringify([entry]))[0].controls.seed,
    "12345678901234567890",
  );
});
test("History keeps the newest 100 searches and tolerates malformed data", () => {
  let history: HistoryEntry[] = [];
  for (let i = 0; i < 105; i++)
    history = addHistory(history, {
      ...entry,
      id: "search-" + i,
      at: entry.at + i,
    });
  assert.equal(history.length, 100);
  assert.equal(history[0].id, "search-104");
  assert.equal(history.at(-1)!.id, "search-5");
  assert.deepEqual(readHistory(JSON.stringify(history.toReversed())), history);
  for (const text of [null, "{", "null", "{}", "[]", "x".repeat(1000001)])
    assert.deepEqual(readHistory(text), []);
});
test("Invalid settings cannot be restored from history", () => {
  for (const invalid of [
    { ...entry, at: 1e20 },
    { ...entry, controls: { ...entry.controls, seed: "4.2" } },
    { ...entry, controls: { ...entry.controls, mood: "unknown" } },
    { ...entry, controls: { ...entry.controls, "rdap-concurrency": "500" } },
    { ...entry, controls: { ...entry.controls, page: "" } },
    { ...entry, controls: { ...entry.controls, length: "5.5" } },
    { ...entry, controls: { ...entry.controls, "check-domains": "false" } },
    { ...entry, controls: { ...entry.controls, unexpected: "value" } },
    { ...entry, reverse: { word: "Figma", mode: "phones", value: "" } },
  ])
    assert.deepEqual(readHistory(JSON.stringify([invalid, entry])), [entry]);
});
test("Fresh seeds remain integers, differ from the previous seed and default on", () => {
  assert.equal(freshSeed("42", 42), "43");
  assert.equal(freshSeed("4294967295", 4294967295), "0");
  assert.equal(freshSeed("42", 123), "123");
  assert.match(freshSeed("-1"), /^\d+$/);
  assert.deepEqual(readAppSettings(null), { randomSeed: true });
  assert.deepEqual(readAppSettings("bad"), { randomSeed: true });
  assert.deepEqual(readAppSettings('{"randomSeed":false}'), {
    randomSeed: false,
  });
});
test("Reload picks another first-row feeling without repeating the current one", () => {
  for (const previous of Object.keys(MOODS)) {
    const others = FRONT.filter((mood) => mood !== previous),
      selected = new Set(
        Array.from({ length: others.length }, (_, value) =>
          freshMood(previous, value),
        ),
      );
    assert.deepEqual(selected, new Set(others));
    assert.notEqual(freshMood(previous, 0xffffffff), previous);
    assert.ok(FRONT.includes(freshMood(previous)));
  }
});
