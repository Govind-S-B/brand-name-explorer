/** Verify every published asset against a clean local build, including lazy assets. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const base = process.env.BASE_URL || "https://govind-s-b.github.io/brand-name-explorer/";
const root = new URL("../dist/", import.meta.url);
async function walk(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await walk(new URL(entry.name + "/", dir), prefix + entry.name + "/"));
    else files.push(prefix + entry.name);
  }
  return files;
}
const hash = data => createHash("sha256").update(data).digest("hex");
const files = [];
for (const path of await walk(root)) {
  const response = await fetch(new URL(path, base), { cache: "no-store" });
  assert.equal(response.status, 200, path);
  const actual = Buffer.from(await response.arrayBuffer());
  const expected = await readFile(new URL(path, root));
  assert.equal(hash(actual), hash(expected), path);
  files.push({ path, status: response.status, bytes: actual.length, sha256: hash(actual), contentType: response.headers.get("content-type") });
}
const result = { base, checkedAt: new Date().toISOString(), allMatchLocalBuild: true, files };
await writeFile(new URL("../docs/live-assets.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(`Verified ${files.length} live files: HTTP 200 and exact SHA-256 match to local build`);
