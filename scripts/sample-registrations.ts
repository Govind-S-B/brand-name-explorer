/**
 * Extend data/registered-sample.tsv: draw raw (unselected) proposals from every
 * mood and record whether each .com is delegated in DNS (NS answer = 1,
 * NXDOMAIN = 0). DNS only, modest rate, no RDAP; a label is a training signal
 * for scripts/build-prior.ts, never an availability claim.
 * Usage: npx tsx scripts/sample-registrations.ts [--per=600] [--lengths=6,7,8] [--seed=1]
 */
import { appendFileSync, readFileSync } from "node:fs";
import { MOODS, MoodSpace } from "../core/generator";
import { liveProviders } from "../lookup/providers";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const out = new URL("../data/registered-sample.tsv", import.meta.url);
const seen = new Set(
  readFileSync(out, "utf8")
    .split("\n")
    .map((line) => line.split("\t")[0]),
);
async function label(name: string, k: number): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await liveProviders
      .dns(name + ".com", (k + attempt) % 2 ? "google" : "cloudflare", AbortSignal.timeout(2500))
      .catch(() => ({ outcome: "error" as const }));
    if (r.outcome === "ns" || r.outcome === "no_ns") return 1;
    if (r.outcome === "nxdomain") return 0;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}
const per = Number(args.per || 600);
for (const length of String(args.lengths || "6,7,8").split(",").map(Number))
  for (const mood of Object.keys(MOODS)) {
    const names: string[] = [];
    for (const parts of new MoodSpace({ mood, length, seed: args.seed || 1 }).proposals()) {
      const name = parts.map((p) => p.text).join("");
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      if (names.length >= per) break;
    }
    let registered = 0,
      labelled = 0;
    for (let i = 0; i < names.length; i += 24) {
      const batch = names.slice(i, i + 24),
        rows = await Promise.all(batch.map(label));
      appendFileSync(
        out,
        rows.map((r, k) => (r === null ? "" : `${batch[k]}\t${r}\n`)).join(""),
      );
      registered += rows.filter((r) => r === 1).length;
      labelled += rows.filter((r) => r !== null).length;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    console.log(mood, length, labelled, "registered", (registered / Math.max(1, labelled)).toFixed(2));
  }
