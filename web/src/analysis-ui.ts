/* Analysis views for the name sheet and Reverse (sound breakdown, inverter fit,
   nearby spellings, reverse report). Imported on first use so the entry bundle
   stays small; it deliberately imports nothing from main.ts. */
type Result = any;
type Apply = (
  dials: Record<string, number>,
  structure: Record<string, string | number>,
  recipe?: string,
) => void;
type Done = (result: Result, error?: string) => void;
const DIALS = ["energy", "weight", "novelty"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
let worker: Worker | undefined,
  lastId = 0;
// The analysis worker answers the latest request; earlier callbacks are dropped.
export function analyse(mode: string, word: string, extra: object, done: Done) {
  worker ||= new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module",
  });
  const id = ++lastId;
  worker.onmessage = (e) => {
    if (e.data.id === id) done(e.data.result, e.data.error);
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = undefined;
    done(
      null,
      "Analysis could not load. If you are offline, open Reverse once while online first.",
    );
  };
  worker.postMessage({ id, mode, word, count: 5, ...extra });
}
function chips(structure: Record<string, string | number>) {
  const box = el("div", "chips");
  for (const [k, v] of Object.entries(structure))
    box.append(
      el(
        "span",
        "",
        k === "length"
          ? `${v} letters`
          : k === "syllables"
            ? `${v} syllables`
            : `${v} ${k}`,
      ),
    );
  return box;
}
function dialBars(dials: Record<string, number>) {
  const box = el("div", "dialbars");
  for (const d of DIALS) {
    const bar = el("i");
    bar.style.setProperty("--v", String(dials[d]));
    box.append(el("span", "", cap(d)), bar, el("b", "", String(dials[d])));
  }
  return box;
}
export function showFit(box: HTMLElement, result: Result, error: string | undefined, apply: Apply) {
  box.replaceChildren();
  if (error) return box.append(el("p", "err", error));
  const [, dials] = result.fits[0],
    use = el("button", "pill-btn", "Use these settings");
  use.onclick = () => apply(dials, result.parsed.structure);
  box.append(
    el("p", "phones", result.phones.join(" ")),
    chips(result.parsed.structure),
    el("p", "analysis-summary", "Closest dial settings"),
    dialBars(dials),
    el("br"),
    use,
  );
}
export function showNearby(box: HTMLElement, result: Result, error?: string) {
  box.replaceChildren();
  if (error) return box.append(el("p", "err", error));
  for (const item of result.results) {
    const card = el("article", "analysis-card");
    card.append(
      el("h3", "", cap(item.word)),
      el(
        "p",
        "",
        [...item.edits, ...item.structure_changes].join(" · ") || "Same sounds",
      ),
    );
    box.append(card);
  }
  if (!result.results.length)
    box.append(el("p", "muted", "No nearby spellings within the search bounds."));
}
export function showReport(box: HTMLElement, result: Result, error: string | undefined, apply: Apply) {
  box.replaceChildren();
  if (error) return;
  const details = el("details");
  box.append(
    el("h2", "r-name", cap(result.reference)),
    el("p", "phones", result.phones.join(" ")),
    el("p", "muted", cap(result.source)),
    chips(result.structure),
  );
  for (const gap of result.gaps) box.append(el("p", "gap", gap));
  if (result.candidates.length)
    box.append(el("p", "analysis-summary", "Settings that make this sound"));
  for (const item of result.candidates) {
    const card = el("article", "candidate"),
      go = el("button", "pill-btn", "Explore these →");
    go.onclick = () => apply(item.dials, result.structure, item.nearest_recipe);
    card.append(
      el("h3", "", `Nearest mood: ${cap(item.nearest_recipe)}`),
      dialBars(item.dials),
      el("p", "samples", item.samples.join("  ")),
      go,
    );
    box.append(card);
  }
  details.append(
    el("summary", "", "Full report and reading notes"),
    el("pre", "", JSON.stringify(result, null, 2)),
  );
  box.append(details);
}
// Name sheet: the inverter reads the spelling from the generator grammar (no
// dictionary download); nearby spellings reuse those phones on request.
export function nameSound(
  word: string,
  seed: string,
  sound: HTMLElement,
  nearby: HTMLElement,
  apply: Apply,
) {
  const find = el("button", "pill-btn", "Find nearby spellings") as HTMLButtonElement;
  find.disabled = true;
  nearby.replaceChildren(find);
  analyse("inverter", word, { seed }, (result, error) => {
    showFit(sound, result, error, apply);
    find.disabled = !result;
    find.onclick = () => {
      nearby.replaceChildren(el("p", "muted", "Searching nearby spellings…"));
      analyse("substitutions", word, { seed, phones: result.phones.join(" ") }, (r, e) =>
        showNearby(nearby, r, e),
      );
    };
  });
}
function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function backup(saved: object, preferences: object) {
  download(
    "brand-name-shortlist.json",
    JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), saved, preferences },
      null,
      2,
    ),
  );
}
// Returns the backup's saved names for main.ts to validate and merge.
export async function readBackup(file?: File) {
  if (!file) return;
  if (file.size > 5000000) throw new Error("Backup must be smaller than 5 MB");
  const data = JSON.parse(await file.text());
  if (data.version !== 1) throw new Error("This is not a valid shortlist backup");
  return data.saved;
}
export function exportCsv(
  list: HTMLElement,
  rows: Map<string, { status: string; source: string; checkedAt: number }>,
) {
  const csv = Array.from(list.children)
    .map((el) => {
      const domain = (el as HTMLElement).dataset.domain!,
        r = rows.get(domain);
      return [
        domain,
        r?.status || "not checked",
        r?.source || "generated",
        r ? new Date(r.checkedAt).toISOString() : "",
      ].join(",");
    })
    .join("\n");
  download(
    "brand-name-results.csv",
    "domain,status,source,checked_at_utc\n" + csv,
    "text/csv",
  );
}
