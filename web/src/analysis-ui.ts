import type { Name, Reading } from "./name-row";
type NameCard = (name: string, reading?: Reading) => HTMLLIElement;
/* Analysis views for the name sheet and Reverse (sound breakdown, inverter fit,
   nearby spellings, reverse report). Imported on first use so the entry bundle
   stays small; it deliberately imports nothing from main.ts. */
type Result = any;
type Apply = (
  dials: Record<string, number>,
  structure: Record<string, string | number>,
  recipe: string,
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
const pending = new Map<number, Done>();
// Reverse and the name sheet can have independent requests in flight.
export function analyse(mode: string, word: string, extra: object, done: Done) {
  worker ||= new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module",
  });
  const id = ++lastId;
  worker.onmessage = (e) => {
    const callback = pending.get(e.data.id);
    pending.delete(e.data.id);
    callback?.(e.data.result, e.data.error);
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = undefined;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks)
      callback(
        null,
        "Analysis could not load. If you are offline, open Reverse once while online first.",
      );
  };
  pending.set(id, done);
  worker.postMessage({ id, mode, word, count: 5, ...extra });
  return () => {
    pending.delete(id);
  };
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
export function showFit(
  box: HTMLElement,
  result: Result,
  error: string | undefined,
  apply: Apply,
) {
  box.replaceChildren();
  if (error) return box.append(el("p", "err", error));
  const [, dials] = result.fits[0],
    use = el("button", "pill-btn", "Explore similar →");
  use.onclick = () =>
    apply(dials, result.parsed.structure, result.nearest_recipe);
  box.append(
    el("p", "phones", result.phones.join(" ")),
    chips(result.parsed.structure),
    el("p", "analysis-summary", "Closest dial settings"),
    dialBars(dials),
    el("br"),
    use,
  );
}
export function showNearby(
  box: HTMLElement,
  result: Result,
  error: string | undefined,
  nameCard: NameCard,
) {
  box.replaceChildren();
  if (error) return box.append(el("p", "err", error));
  const list = el("ul", "feed nearby-names");
  list.setAttribute("aria-label", "Nearby spellings");
  for (const item of result.results) {
    const card = nameCard(item.word);
    const changes = item.structure_changes.map((change: string) => {
      const length = /^length: (\d+) → (\d+)$/.exec(change);
      if (!length) return change;
      const delta = Number(length[2]) - Number(length[1]);
      return (
        Math.abs(delta) +
        (delta > 0 ? " extra letter" : " fewer letter") +
        (Math.abs(delta) === 1 ? "" : "s")
      );
    });
    card.append(
      el(
        "p",
        "name-note",
        [
          ...(item.edits.length ? item.edits : ["Same sounds"]),
          ...changes,
        ].join(" · "),
      ),
    );
    list.append(card);
  }
  box.append(list);
  for (const note of result.relaxed) box.append(el("p", "fine-print", note));
  if (!result.results.length)
    box.append(
      el("p", "muted", "No nearby spellings within the search bounds."),
    );
}
export function showReport(
  box: HTMLElement,
  result: Result,
  error: string | undefined,
  apply: Apply,
  nameCard: NameCard,
) {
  box.replaceChildren();
  if (error) return;
  const details = el("details"),
    reference = el("ul", "feed reference-name");
  reference.setAttribute("aria-label", "Reference name");
  reference.append(
    nameCard(result.reference, {
      phones: result.phones,
      source: result.source,
      boundaries: result.syllable_boundaries,
    }),
  );
  box.append(
    reference,
    el("p", "phones", result.phones.join(" ")),
    el("p", "muted", cap(result.source)),
    chips(result.structure),
  );
  for (const gap of result.gaps) box.append(el("p", "gap", gap));
  if (result.candidates.length)
    box.append(el("p", "analysis-summary", "Settings that make this sound"));
  for (const item of result.candidates) {
    const card = el("article", "candidate"),
      go = el("button", "pill-btn", "Explore similar →");
    go.onclick = () => apply(item.dials, result.structure, item.nearest_recipe);
    const samples = el("ul", "feed samples");
    samples.setAttribute("aria-label", "Example names");
    for (const name of item.samples) samples.append(nameCard(name));
    card.append(
      el("h3", "", `Nearest mood: ${cap(item.nearest_recipe)}`),
      dialBars(item.dials),
      samples,
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
// Generated names fit from spelling without downloading the dictionary. References
// retain their supplied reading; unsupported spellings fall back to Reverse.
export function nameSound(
  item: Name,
  seed: string,
  sound: HTMLElement,
  nearby: HTMLElement,
  apply: Apply,
  nameCard: NameCard,
) {
  const find = el(
    "button",
    "pill-btn",
    "Find nearby spellings",
  ) as HTMLButtonElement;
  find.disabled = true;
  nearby.replaceChildren(find);
  let cancel = analyse(
    "name",
    item.name.toLowerCase(),
    {
      seed,
      phones: item.reading?.phones.join(" "),
      boundaries: item.reading?.boundaries,
    },
    (result, error) => {
      if (error) sound.replaceChildren(el("p", "err", error));
      else if (result.fits) showFit(sound, result, undefined, apply);
      else {
        const candidate = result.candidates[0];
        if (candidate)
          showFit(
            sound,
            {
              phones: result.phones,
              fits: [[0, candidate.dials]],
              parsed: { structure: result.structure },
              nearest_recipe: candidate.nearest_recipe,
            },
            undefined,
            apply,
          );
        else {
          sound.replaceChildren(
            el("p", "phones", result.phones.join(" ")),
            chips(result.structure),
          );
          sound.append(
            el("p", "analysis-summary", "No matching generator settings"),
          );
          for (const gap of result.gaps) sound.append(el("p", "gap", gap));
        }
        sound.append(
          el("p", "fine-print", item.reading?.source || result.source),
        );
      }
      find.disabled = !result;
      find.onclick = () => {
        nearby.replaceChildren(el("p", "muted", "Searching nearby spellings…"));
        cancel = analyse(
          "substitutions",
          item.name,
          { seed, phones: result.phones.join(" ") },
          (r, e) => showNearby(nearby, r, e, nameCard),
        );
      };
    },
  );
  return () => cancel();
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
  if (data.version !== 1)
    throw new Error("This is not a valid shortlist backup");
  return data.saved;
}
export function exportCsv(
  domains: string[],
  rows: Map<string, { status: string; source: string; checkedAt: number }>,
) {
  const csv = domains
    .map((domain) => {
      const r = rows.get(domain);
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
