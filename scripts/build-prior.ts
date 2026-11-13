/**
 * Build core/prior.json: the mood-independent "does this look like a name
 * people want" prior. Two sources, both reproducible from files in data/:
 *   1. a letter-trigram model of the bundled CMU dictionary spellings;
 *   2. a logistic regression of .com registration (DNS delegation sampled once,
 *      see data/README.md) on grammar tokens and whole-word structure.
 * Usage: npx tsx scripts/build-prior.ts [labels.tsv]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Dictionary } from "../core/dictionary";
import { runs, unit, traits, trigramIndexes, rareLetters, type Unit } from "../core/grammar";

const root = new URL("../", import.meta.url);
const dictionary = new Dictionary(readFileSync(new URL("data/cmudict.bin", root)));
// 1. Letter trigrams (type counts, add-0.1 smoothing), stored as -log2 p in 1/16 bit steps.
const counts = new Float64Array(28 ** 3),
  context = new Float64Array(28 ** 2);
for (const word of dictionary.words()) {
  if (!/^[a-z]{3,12}$/.test(word)) continue;
  for (const index of trigramIndexes(word)) {
    counts[index]++;
    context[Math.floor(index / 28)]++;
  }
}
const quantized = new Uint8Array(28 ** 3);
for (let i = 0; i < quantized.length; i++)
  quantized[i] = Math.min(
    255,
    Math.round(-16 * Math.log2((counts[i] + 0.1) / (context[Math.floor(i / 28)] + 2.7))),
  );
const bits = (word: string) => {
  let total = 0,
    worst = 0;
  const indexes = trigramIndexes(word);
  for (const i of indexes) {
    total += quantized[i];
    worst = Math.max(worst, quantized[i]);
  }
  return { mean: total / 16 / indexes.length, worst: worst / 16 };
};
// 2. Registration regression.
export function features(word: string): Map<string, number> | undefined {
  const parts: Unit[] = [];
  const f = new Map<string, number>();
  const add = (k: string, v = 1) => f.set(k, (f.get(k) || 0) + v);
  const split = runs(word);
  for (const { text, position } of split) {
    const u = unit(position, text);
    if (!u) return;
    parts.push(u);
    add(position + ":" + text);
  }
  if (parts[0].vowel) add("vowelStart");
  if (parts.at(-1)!.vowel) add("open");
  const t = traits(parts);
  add("complexity", t.complexity);
  add("echoC", t.echoC);
  add("echoV", t.echoV);
  add("redup", t.redup);
  if (t.manners) add("manners" + t.manners);
  add("inward", t.inward);
  add("rare", rareLetters(word));
  add("uh", t.uh);
  const b = bits(word);
  add("bits", b.mean - 4);
  add("worstBits", (b.worst - 7) / 3);
  // Length only absorbs the "longer names are freer" effect; it is not shipped.
  add("length" + word.length);
  add("bias");
  return f;
}
const labels = readFileSync(process.argv[2] || new URL("data/registered-sample.tsv", root), "utf8")
  .trim()
  .split("\n")
  .map((line) => line.split("\t"))
  .filter((row) => /^[a-z]+$/.test(row[0]));
const data = labels.flatMap(([name, registered], i) => {
  const f = features(name);
  return f ? [{ f, y: Number(registered), test: i % 5 === 0 }] : [];
});
const w = new Map<string, number>();
const predict = (f: Map<string, number>) => {
  let z = 0;
  for (const [k, v] of f) z += (w.get(k) || 0) * v;
  return z;
};
function fit(rows: typeof data, l2 = 3) {
  w.clear();
  for (let epoch = 0; epoch < 400; epoch++) {
    const gradient = new Map<string, number>();
    for (const d of rows) {
      const error = 1 / (1 + Math.exp(-predict(d.f))) - d.y;
      for (const [k, v] of d.f) gradient.set(k, (gradient.get(k) || 0) + error * v);
    }
    const rate = 10 / Math.sqrt(1 + epoch / 20);
    for (const [k, g] of gradient) {
      const current = w.get(k) || 0;
      w.set(k, current - (rate * (g + (k === "bias" ? 0 : l2 * current))) / rows.length);
    }
  }
}
const auc = (rows: typeof data) => {
  const positive = rows.filter((d) => d.y).map((d) => predict(d.f)),
    negative = rows.filter((d) => !d.y).map((d) => predict(d.f));
  let wins = 0;
  for (const p of positive) for (const q of negative) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (positive.length * negative.length);
};
// 3. Teacher layer: blind judgments of generated names (data/teacher-judgments.tsv:
// name, intended mood, batch, judged mood, quality 1-5, round). A compact
// model of how a judge reads mood and rates quality, distilled for the scorer.
// Filled from the judgments below: every mood a judge has been offered.
const TEACHER_MOODS: string[] = [];
export function teacherFeatures(word: string): Map<string, number> | undefined {
  const f = new Map<string, number>();
  const add = (k: string, v = 1) => f.set(k, (f.get(k) || 0) + v);
  const parts: Unit[] = [];
  for (const { text, position } of runs(word)) {
    const u = unit(position, text);
    if (!u) return;
    parts.push(u);
    for (const sound of new Set(u.sounds)) add("s:" + sound);
    if (position === "o" || position === "i") for (const sound of u.sounds) add("first:" + sound);
    if (position === "c" || position === "f") add("end:" + text);
    for (const tag of u.tags) add("tag:" + tag);
    if (!u.vowel && u.sounds.length > 1) add("cluster");
  }
  const t = traits(parts);
  if (parts[0].vowel) add("vowelStart");
  if (parts.at(-1)!.vowel) add("open");
  add("complexity", t.complexity);
  add("echoC", t.echoC);
  add("echoV", t.echoV);
  add("redup", t.redup);
  if (t.manners) add("manners" + t.manners);
  add("rare", rareLetters(word));
  add("uh", t.uh);
  add("syllables", t.syllables - 2.5);
  add("digraphs", t.digraphs);
  add("bits", bits(word).mean - 4);
  add("length", word.length - 6);
  add("bias");
  return f;
}
const dot = (weights: Map<string, number>, f: Map<string, number>) => {
  let z = 0;
  for (const [k, v] of f) z += (weights.get(k) || 0) * v;
  return z;
};
const judged = readFileSync(new URL("data/teacher-judgments.tsv", root), "utf8")
  .trim()
  .split("\n")
  .map((line) => line.split("\t"));
// Only moods that still exist are modelled; judgments naming a retired mood
// still count toward quality.
const current = Object.keys(
  JSON.parse(readFileSync(new URL("core/constants.json", root), "utf8")).moods,
);
for (const row of judged)
  if (current.includes(row[3]) && !TEACHER_MOODS.includes(row[3])) TEACHER_MOODS.push(row[3]);
TEACHER_MOODS.sort((a, b) => current.indexOf(a) - current.indexOf(b));
// Judges differ in harshness: centre quality within each round, then average repeats.
const roundMean = new Map<string, number>();
for (const round of new Set(judged.map((r) => r[5]))) {
  const rows = judged.filter((r) => r[5] === round);
  roundMean.set(round, rows.reduce((n, r) => n + Number(r[4]), 0) / rows.length);
}
const byName = new Map<string, { moods: string[]; quality: number[] }>();
for (const [name, , , mood, quality, round] of judged) {
  const entry = byName.get(name) ?? { moods: [], quality: [] };
  entry.moods.push(mood);
  entry.quality.push(Number(quality) - roundMean.get(round)!);
  byName.set(name, entry);
}
const lessons = [...byName].flatMap(([name, entry], i) => {
  const f = teacherFeatures(name);
  return f
    ? [{ f, moods: entry.moods, quality: entry.quality.reduce((a, b) => a + b) / entry.quality.length, fold: i % 5 }]
    : [];
});
type Lesson = (typeof lessons)[number];
function fitQuality(rows: Lesson[], l2 = 10) {
  const weights = new Map<string, number>();
  for (let epoch = 0; epoch < 600; epoch++) {
    const gradient = new Map<string, number>();
    for (const d of rows) {
      const error = dot(weights, d.f) - d.quality;
      for (const [k, v] of d.f) gradient.set(k, (gradient.get(k) || 0) + error * v);
    }
    const rate = 0.25 / Math.sqrt(1 + epoch / 50);
    for (const [k, g] of gradient) {
      const current = weights.get(k) || 0;
      weights.set(k, current - (rate * (g + (k === "bias" ? 0 : l2 * current))) / rows.length);
    }
  }
  return weights;
}
function fitMoods(rows: Lesson[], l2 = 3) {
  const weights = TEACHER_MOODS.map(() => new Map<string, number>());
  for (let epoch = 0; epoch < 250; epoch++) {
    const gradient = TEACHER_MOODS.map(() => new Map<string, number>());
    for (const d of rows) {
      const z = weights.map((w) => dot(w, d.f)),
        top = Math.max(...z),
        e = z.map((v) => Math.exp(v - top)),
        total = e.reduce((a, b) => a + b);
      TEACHER_MOODS.forEach((mood, c) => {
        // Soft target: the share of judges who read this mood.
        const target = d.moods.filter((m) => m === mood).length / d.moods.length,
          error = e[c] / total - target;
        for (const [k, v] of d.f) gradient[c].set(k, (gradient[c].get(k) || 0) + error * v);
      });
    }
    const rate = 5 / Math.sqrt(1 + epoch / 30);
    TEACHER_MOODS.forEach((_, c) => {
      for (const [k, g] of gradient[c]) {
        const current = weights[c].get(k) || 0;
        weights[c].set(k, current - (rate * (g + l2 * current)) / rows.length);
      }
    });
  }
  return weights;
}
let moodHits = 0;
const predictedQuality: number[] = [],
  actualQuality: number[] = [];
for (let fold = 0; fold < 5; fold++) {
  const train = lessons.filter((d) => d.fold !== fold),
    test = lessons.filter((d) => d.fold === fold),
    q = fitQuality(train),
    m = fitMoods(train);
  for (const d of test) {
    predictedQuality.push(dot(q, d.f));
    actualQuality.push(d.quality);
    const z = m.map((w) => dot(w, d.f));
    if (d.moods.includes(TEACHER_MOODS[z.indexOf(Math.max(...z))])) moodHits++;
  }
}
const correlation = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b) / xs.length,
    my = ys.reduce((a, b) => a + b) / ys.length;
  let xy = 0,
    xx = 0,
    yy = 0;
  xs.forEach((x, i) => {
    xy += (x - mx) * (ys[i] - my);
    xx += (x - mx) ** 2;
    yy += (ys[i] - my) ** 2;
  });
  return xy / Math.sqrt(xx * yy);
};
const teacherQuality = fitQuality(lessons),
  teacherMoods = fitMoods(lessons);
const compact = (weights: Map<string, number>) =>
  Object.fromEntries(
    [...weights].filter(([, v]) => Math.abs(v) >= 0.005).map(([k, v]) => [k, Number(v.toFixed(3))]),
  );
const teacher = {
  source: {
    names: lessons.length,
    judgments: judged.length,
    heldOutMoodAgreement: Number((moodHits / lessons.length).toFixed(3)),
    heldOutQualityCorrelation: Number(correlation(predictedQuality, actualQuality).toFixed(3)),
  },
  quality: compact(teacherQuality),
  moods: Object.fromEntries(TEACHER_MOODS.map((mood, c) => [mood, compact(teacherMoods[c])])),
};
console.log("teacher", teacher.source);
fit(data.filter((d) => !d.test));
const heldOut = auc(data.filter((d) => d.test));
fit(data);
const round = (v: number) => Number(v.toFixed(3));
const tokens: Record<string, Record<string, number>> = {};
const global: Record<string, number> = {};
for (const [k, v] of w) {
  const at = k.indexOf(":");
  if (at === 1) (tokens[k[0]] ??= {})[k.slice(2)] = round(v);
  else if (k !== "bias" && !k.startsWith("length")) global[k] = round(v);
}
const shipped = (f: Map<string, number>) => {
  let z = 0;
  for (const [k, v] of f) if (k !== "bias" && !k.startsWith("length")) z += (w.get(k) || 0) * v;
  return z;
};
const quantiles = (rows: typeof data) => {
  const xs = rows.map((d) => shipped(d.f)).sort((a, b) => a - b);
  return [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => round(xs[Math.floor(q * (xs.length - 1))]));
};
writeFileSync(
  new URL("core/prior.json", root),
  JSON.stringify({
    source: {
      labels: data.length,
      registered: round(data.filter((d) => d.y).length / data.length),
      heldOutAuc: round(heldOut),
    },
    // Names scoring above this (the lower quartile of registered names) earn no extra credit.
    enough: quantiles(data.filter((d) => d.y))[1],
    // Intercept and per-length offsets turn the score into P(registered).
    bias: round(w.get("bias") || 0),
    lengths: Object.fromEntries(
      [...w].filter(([k]) => k.startsWith("length")).map(([k, v]) => [k.slice(6), round(v)]),
    ),
    tokens,
    global,
    teacher,
    trigram: Buffer.from(quantized).toString("base64"),
  }) + "\n",
);
console.log({
  labels: data.length,
  heldOutAuc: round(heldOut),
  bias: round(w.get("bias") || 0),
  registeredQuantiles: quantiles(data.filter((d) => d.y)),
  unregisteredQuantiles: quantiles(data.filter((d) => !d.y)),
  global,
});
