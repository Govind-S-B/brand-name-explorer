import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generate } from "../core/generator";
const run = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "cli/main.ts", ...args], {
    encoding: "utf8",
  });
test("CLI defaults, paging and arbitrarily large integer seeds match the shared engine", () => {
  const r = run([
    "--no-check-com",
    "--count",
    "10",
    "--page",
    "2",
    "--seed",
    "12345678901234567890",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    r.stdout.trim().split("\n"),
    generate({ seed: "12345678901234567890" }, 10, 2),
  );
  const explain = run(["--explain"]);
  assert.equal(explain.status, 0);
  const value = JSON.parse(explain.stdout);
  assert.equal(value.checking, true);
  assert.equal(value.filtered, true);
  assert.equal(value.count, 200);
});
test("CLI rejects removed flags and invalid controls before any lookup", () => {
  for (const args of [
    ["--style", "calm"],
    ["--exclude-registered"],
    ["--length", "15"],
    ["--seed", "2.5"],
    ["--count", "0"],
    ["--energy", "NaN"],
  ]) {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
  }
});
