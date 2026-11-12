import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFrom, nameKey, validSaved } from "../web/src/name-row";

test("Name identity is shared across generated names, references and saved names", () => {
  assert.equal(nameKey(nameFrom("Goftoo")), nameKey(nameFrom("goftoo")));
  assert.deepEqual(nameFrom(" Goftoo "), {
    name: "Goftoo",
    domain: "goftoo.com",
  });
  assert.equal(nameFrom("Studio-42").domain, "studio-42.com");
});
test("References never silently become a different .com address", () => {
  for (const name of [
    "Open AI",
    "figma.com",
    "café",
    "ßound",
    "ıdea",
    "-alpha",
    "alpha-",
    "a".repeat(64),
    "<img src=x>",
  ]) {
    const item = nameFrom(name);
    assert.equal(item.domain, undefined);
    assert.equal(nameKey(item), "name:" + name.toLowerCase());
  }
  assert.throws(() => nameFrom(""));
  assert.throws(() => nameFrom("a\nb"));
});
test("Existing shortlist backups still validate without changing their keys", () => {
  assert.ok(
    validSaved({
      "goftu.com": { name: "Goftu", domain: "goftu.com", addedAt: 1 },
    }),
  );
});
test("Text references and intended pronunciation survive shortlist backup validation", () => {
  const item = nameFrom("Open AI", {
    phones: ["OW", "P", "AH", "N", "EY", "AY"],
    source: "Supplied reading",
    boundaries: [4],
  });
  const saved = { [nameKey(item)]: { ...item, addedAt: 1 } };
  assert.ok(validSaved(JSON.parse(JSON.stringify(saved))));
});
test("Shortlist imports reject mismatched names, domains and malformed readings", () => {
  for (const entry of [
    { name: "Else", domain: "goftu.com", addedAt: 1 },
    { name: "Goftu", domain: "https://evil.example", addedAt: 1 },
    {
      name: "Goftu",
      domain: "goftu.com",
      addedAt: 1,
      reading: { phones: ["<script>"], source: "test" },
    },
    {
      name: "Goftu",
      domain: "goftu.com",
      addedAt: 1,
      reading: { phones: ["G"], source: "test", boundaries: [9] },
    },
    { name: "Goftu", domain: "goftu.com", addedAt: null },
  ])
    assert.equal(validSaved({ "goftu.com": entry }), false);
});
