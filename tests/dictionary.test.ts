import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Dictionary } from "../core/dictionary";
test("All 126052 encoded dictionary words/readings equal the Python dictionary", () => {
  const expected = JSON.parse(
    readFileSync(new URL("./dictionary-golden.json", import.meta.url), "utf8"),
  );
  const bytes = readFileSync(new URL("../data/cmudict.bin", import.meta.url));
  const dictionary = new Dictionary(bytes);
  const size = bytes.readUInt32LE(4),
    header = JSON.parse(bytes.subarray(8, 8 + size).toString()),
    blocks = Math.ceil(header.count / header.blockSize);
  const start = 8 + size + (blocks + 1) * 8,
    words: string[] = [];
  let at = start,
    word = "";
  for (let i = 0; i < header.count; i++) {
    if (i % 32 === 0) word = "";
    const prefix = bytes[at++],
      length = bytes[at++];
    word = word.slice(0, prefix) + bytes.subarray(at, at + length).toString();
    at += length;
    words.push(word);
  }
  assert.equal(dictionary.count, expected.count);
  const rows = words.map((word: string) => [word, dictionary.get(word)]);
  assert.equal(
    createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    expected.sha256,
  );
  assert.equal(dictionary.get("zzzz-not-a-word"), undefined);
  assert.throws(() => new Dictionary(new Uint8Array([0, 1, 2, 3])));
});
