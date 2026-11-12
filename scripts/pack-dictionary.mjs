/** Pack an upstream CMUdict text file. Usage: node scripts/pack-dictionary.mjs path/to/cmudict.dict */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = await readFile(process.argv[2]);
const entries = new Map();
for (const line of source.toString("utf8").split("\n")) {
  const i = line.indexOf(" ");
  if (i < 0) continue;
  const word = line.slice(0, i).replace(/\(\d+\)$/, ""),
    phones = line
      .slice(i + 1)
      .split("#")[0]
      .trim()
      .split(/\s+/);
  if (!phones[0]) continue;
  const list = entries.get(word) || [];
  list.push(phones);
  entries.set(word, list);
}
const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const phones = [...new Set(sorted.flatMap(([, r]) => r.flat()))].sort();
const indexes = new Map(phones.map((p, i) => [p, i]));
const encoder = new TextEncoder(),
  blockSize = 32,
  offsets = [],
  bytes = [],
  readingsBytes = [];
let previous = new Uint8Array();
for (let i = 0; i < sorted.length; i++) {
  const [word, readings] = sorted[i],
    encoded = encoder.encode(word);
  if (/[^\x00-\x7F]/.test(word))
    throw new Error("Dictionary words must be ASCII");
  if (i % blockSize === 0) {
    offsets.push(bytes.length, readingsBytes.length);
    previous = new Uint8Array();
  }
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < encoded.length &&
    previous[prefix] === encoded[prefix]
  )
    prefix++;
  const suffix = encoded.slice(prefix);
  if (
    prefix > 255 ||
    suffix.length > 255 ||
    readings.length > 255 ||
    phones.length > 255
  )
    throw new Error("Dictionary exceeds byte format");
  bytes.push(prefix, suffix.length, ...suffix);
  readingsBytes.push(readings.length);
  for (const r of readings) {
    if (r.length > 255) throw new Error("Reading too long");
    readingsBytes.push(r.length, ...r.map((p) => indexes.get(p)));
  }
  previous = encoded;
}
offsets.push(bytes.length, readingsBytes.length);
const header = Buffer.from(
  JSON.stringify({
    phones,
    blockSize,
    count: sorted.length,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  }),
);
const head = Buffer.alloc(8 + header.length + offsets.length * 4);
head.write("BNE1");
head.writeUInt32LE(header.length, 4);
header.copy(head, 8);
offsets.forEach((o, i) => head.writeUInt32LE(o, 8 + header.length + i * 4));
await mkdir("data", { recursive: true });
await writeFile(
  "data/cmudict.bin",
  Buffer.concat([head, Buffer.from(bytes), Buffer.from(readingsBytes)]),
);
console.log({
  words: sorted.length,
  bytes: head.length + bytes.length + readingsBytes.length,
  sourceSha256: createHash("sha256").update(source).digest("hex"),
});
