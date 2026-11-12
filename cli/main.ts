import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  MOODS,
  DIALS,
  MoodSpace,
  generate,
  type Settings,
} from "../core/generator";
import { LookupEngine, NODE_LOOKUP } from "../lookup/engine";
import { searchNames } from "../lookup/search";
import { NodeStore } from "./store";
import {
  installDictionary,
  setDictionaryLoader,
  readReference,
} from "../core/pronunciation";
import { report, parseSpelling, fitProfiles } from "../core/inverter";
import { suggest } from "../core/substitutions";
const help = `Brand name explorer — sound-based names and RDAP-confirmed .com checks

bne [options]                     generate and check names
bne reverse WORD [--reading ... | --phones ...]
bne invert WORD                  fit exact spelling to sound dials
bne substitute WORD [--reading ... | --phones ...]

--mood calm                       recipe; --list-moods lists all seven
--blend playful:0.3                blend recipe dials
--energy N --weight N --novelty N   explicit 0–10 dials
--opening any|vowel|consonant|cluster --syllables 1..5
--ending open|closed|either --length 3..14 (default 6)
--seed 42 --count 200 --page 1
--[no-]check-com --[no-]hide-registered (both on)
--[no-]dns --refresh --cache PATH (default .cache/names.sqlite)
--lookup-workers 32 --lookup-rate 160
--dns-workers 32 --dns-rate 160
--list-moods --list-dials --explain --cache-stats --clear-cache
--help

Output is TSV for checked names, one name per line without checks.
Saved checks/pages persist until --refresh; errors never mean available.`;
const strings = [
  "mood",
  "blend",
  "energy",
  "weight",
  "novelty",
  "opening",
  "syllables",
  "ending",
  "length",
  "seed",
  "count",
  "page",
  "cache",
  "lookup-workers",
  "lookup-rate",
  "dns-workers",
  "dns-rate",
  "reading",
  "phones",
];
const flags = [
  "check-com",
  "hide-registered",
  "dns",
  "refresh",
  "list-moods",
  "list-dials",
  "explain",
  "cache-stats",
  "clear-cache",
  "help",
];
const numeric = (value: string | boolean | undefined, fallback: number) =>
  value === undefined ? fallback : Number(value);
async function main() {
  const { values, positionals } = parseArgs({
    options: Object.fromEntries([
      ...strings.map((k) => [k, { type: "string" as const }]),
      ...flags.map((k) => [k, { type: "boolean" as const }]),
    ]),
    allowNegative: true,
    allowPositionals: true,
  });
  const v = values as Record<string, string | boolean | undefined>;
  if (v.help) {
    console.log(help);
    return;
  }
  if (v["list-moods"]) {
    console.log("mood\tenergy\tweight\tnovelty\tending");
    for (const [m, p] of Object.entries(MOODS))
      console.log([m, p.energy, p.weight, p.novelty, p.ending].join("\t"));
    return;
  }
  if (v["list-dials"]) {
    console.log(
      "energy: smooth → percussive\nweight: light → heavy\nnovelty: familiar → unusual\nAll dials accept 0–10; 5 is neutral.",
    );
    return;
  }
  const count = numeric(v.count, positionals[0] === "substitute" ? 10 : 200),
    page = numeric(v.page, 1);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(page) ||
    page < 1
  )
    throw new Error("count and page must be positive integers");
  if (positionals.length) {
    const [mode, word, ...extra] = positionals;
    if (
      !word ||
      extra.length ||
      !["reverse", "invert", "substitute"].includes(mode)
    )
      throw new Error(
        "Use reverse, invert, or substitute followed by one word",
      );
    setDictionaryLoader(async () =>
      installDictionary(
        await readFile(new URL("./cmudict.bin", import.meta.url)),
      ),
    );
    const result =
      mode === "invert"
        ? fitProfiles(parseSpelling(word)).slice(0, 10)
        : mode === "reverse"
          ? await report(
              word,
              v.reading as string | undefined,
              v.phones as string | undefined,
              v.seed as string | undefined,
            )
          : suggest(
              await readReference(
                word,
                v.reading as string | undefined,
                v.phones as string | undefined,
              ),
              word,
              count,
            );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const settings: Settings = {
    mood: String(v.mood || "calm"),
    length: numeric(v.length, 6),
    seed: String(v.seed ?? "42"),
    opening: (v.opening || "any") as Settings["opening"],
    syllables: v.syllables === undefined ? null : Number(v.syllables),
  };
  if (v.blend !== undefined) settings.blend = String(v.blend);
  if (v.ending !== undefined) settings.ending = v.ending as Settings["ending"];
  for (const d of DIALS) if (v[d] !== undefined) settings[d] = Number(v[d]);
  if (!/^-?\d+$/.test(String(settings.seed)))
    throw new Error("Seed must be an integer");
  const space = new MoodSpace(settings);
  const checking = v["check-com"] !== false,
    filtered = v["hide-registered"] !== false;
  if (v.explain) {
    console.log(
      JSON.stringify(
        {
          settings,
          profile: space.profile,
          sources: Object.fromEntries(
            DIALS.map((d) => [
              d,
              v[d] !== undefined ? "explicit" : v.blend ? "blend" : "mood",
            ]),
          ),
          capacity: space.capacity,
          checking,
          filtered: checking && filtered,
          count,
          page,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!checking) {
    console.log(generate(settings, count, page).join("\n"));
    return;
  }
  const store = new NodeStore(
    resolve(String(v.cache || ".cache/names.sqlite")),
  );
  if (v["clear-cache"] || v["cache-stats"]) {
    if (v["clear-cache"]) store.clearCache();
    console.log(JSON.stringify(store.stats()));
    store.close();
    return;
  }
  const engine = new LookupEngine(
    store,
    {
      ...NODE_LOOKUP,
      dns: v.dns !== false,
      rdapConcurrency: numeric(v["lookup-workers"], 32),
      rdapRate: numeric(v["lookup-rate"], 160),
      dnsConcurrency: numeric(v["dns-workers"], 32),
      dnsRate: numeric(v["dns-rate"], 160),
    },
    undefined,
    "node",
  );
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    void engine.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const start = performance.now();
  try {
    await searchNames(
      { settings, count, page, filtered, refresh: Boolean(v.refresh) },
      store,
      engine,
      (type, data) => {
        if (type === "row")
          console.log(
            [data.row.domain, data.row.status, data.row.source].join("\t"),
          );
        if (type === "done")
          console.error(
            JSON.stringify({
              seconds: (performance.now() - start) / 1000,
              ...data,
              stats: engine.stats,
            }),
          );
      },
      controller.signal,
    );
  } finally {
    await engine.close();
    store.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
