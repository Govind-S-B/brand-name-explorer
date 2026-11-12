import "./style.css";
import {
  MOODS,
  DIALS,
  generate,
  resolveProfile,
  type Settings,
  type Ending,
  type Opening,
} from "./core/generator";
import type { DomainRow } from "./lookup/store";
import { DEFAULT_LOOKUP, type LookupOptions } from "./lookup/engine";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let mood = "calm",
  rows = new Map<string, DomainRow>(),
  saved: Record<string, { name: string; domain: string; addedAt: number }> = {},
  running = false,
  paused = false,
  requestId = 0,
  activeSearch: SearchState | undefined,
  analysisWorker: Worker | undefined,
  analysisId = 0,
  analysisBusy = false;
interface SearchState {
  settings: Settings;
  count: number;
  page: number;
  filtered: boolean;
  options: Partial<LookupOptions>;
}
const prefKey = "bne.preferences.v1",
  savedKey = "bne.shortlist.v1",
  activeKey = "bne.active.v1";
function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    $("#notice").hidden = false;
    $("#notice").textContent =
      "Local storage is unavailable. Download a shortlist backup before closing this tab.";
    return false;
  }
}
function validSaved(value: unknown): value is typeof saved {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length <= 10000 &&
    Object.entries(value).every(
      ([key, v]) =>
        v &&
        typeof v === "object" &&
        /^[a-z]{2,15}\.com$/.test(key) &&
        typeof (v as any).name === "string" &&
        (v as any).name.toLowerCase() + ".com" === key &&
        (v as any).domain === key &&
        Number.isFinite((v as any).addedAt),
    ),
  );
}
try {
  const value = JSON.parse(storageGet(savedKey) || "{}");
  if (validSaved(value)) saved = value;
} catch {
  /* retain an empty, exportable shortlist */
}
const lookup = new Worker(new URL("./lookup.worker.ts", import.meta.url), {
  type: "module",
});
const input = (id: string) => $<HTMLInputElement>("#" + id),
  select = (id: string) => $<HTMLSelectElement>("#" + id),
  number = (id: string) => Number(input(id).value);
function settings(): Settings {
  const style = select("engine").value;
  if (!/^-?\d+$/.test(input("seed").value))
    throw new Error("Seed must be an integer");
  if (style)
    return { style, length: number("length"), seed: input("seed").value };
  const result: Settings = {
    mood,
    length: number("length"),
    seed: input("seed").value,
    syllables: select("syllables").value
      ? Number(select("syllables").value)
      : null,
    opening: select("opening").value as Opening,
  };
  if (select("ending").value) result.ending = select("ending").value as Ending;
  if (select("blend").value)
    result.blend = select("blend").value + ":" + input("blend-amount").value;
  for (const d of DIALS)
    if (input(d).dataset.explicit === "true") result[d] = number(d);
  return result;
}
function options(): Partial<LookupOptions> {
  return {
    ...DEFAULT_LOOKUP,
    dns: input("use-dns").checked,
    rdapConcurrency: number("rdap-concurrency"),
    rdapRate: number("rdap-rate"),
    dnsConcurrency: number("dns-concurrency"),
    dnsRate: number("dns-rate"),
    dnsTimeout: number("dns-timeout"),
    hedgeDelay: number("hedge-delay"),
  };
}
function syncProfile() {
  const profile = resolveProfile({
    mood,
    ...(select("blend").value
      ? { blend: select("blend").value + ":" + input("blend-amount").value }
      : {}),
  });
  $("#blend-face").textContent =
    select("blend").selectedOptions[0]?.text || "+ blend";
  for (const d of DIALS) {
    if (input(d).dataset.explicit !== "true")
      input(d).value = String(profile[d]);
    $("#" + d + "-value").textContent = input(d).value;
  }
  $("#sound-summary").textContent =
    `${input("length").value} letters · ${select("syllables").value || "auto"} syl${DIALS.some((d) => input(d).dataset.explicit === "true") ? " · custom dials" : ""}`;
  $("#domain-summary").textContent = input("check-domains").checked
    ? input("filter-available").checked
      ? "available only"
      : "live .com checks"
    : "off · generate only";
}
function setMood(value: string) {
  mood = value;
  document
    .querySelectorAll<HTMLButtonElement>("[data-mood]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mood === mood)),
    );
  for (const d of DIALS) delete input(d).dataset.explicit;
  syncProfile();
}
function savePreferences() {
  const values: Record<string, string | boolean> = { mood };
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "#panel-explore input, #panel-explore select",
    )
    .forEach((el) => {
      if (el.id === "refresh") return;
      values[el.id] =
        el instanceof HTMLInputElement && el.type === "checkbox"
          ? el.checked
          : el.value;
    });
  values.explicit = DIALS.filter(
    (d) => input(d).dataset.explicit === "true",
  ).join(",");
  storageSet(prefKey, JSON.stringify(values));
}
try {
  const prefs = JSON.parse(storageGet(prefKey) || "{}");
  for (const [id, value] of Object.entries(prefs)) {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      if (el instanceof HTMLInputElement && el.type === "checkbox")
        el.checked = Boolean(value);
      else if (typeof value === "string") el.value = value;
    }
  }
  if (Object.hasOwn(MOODS, prefs.mood)) mood = prefs.mood;
  for (const d of DIALS)
    if (
      String(prefs.explicit || "")
        .split(",")
        .includes(d)
    )
      input(d).dataset.explicit = "true";
} catch {
  /* use defaults */
}
document.querySelectorAll<HTMLButtonElement>("[data-mood]").forEach((b) => {
  b.setAttribute("aria-pressed", String(b.dataset.mood === mood));
  b.onclick = () => {
    setMood(b.dataset.mood!);
    input("page").value = "1";
    savePreferences();
  };
});
for (const d of DIALS)
  input(d).oninput = () => {
    input(d).dataset.explicit = "true";
    $("#" + d + "-value").textContent = input(d).value;
    savePreferences();
  };
function syncEngine(resetLength = false) {
  const style = select("engine").value;
  if (resetLength)
    input("length").value =
      style === "flowing" ? "5" : style === "expansive" ? "7" : "6";
  input("length").min = style === "calm" ? "2" : "3";
  input("length").max =
    style === "expansive" ? "15" : style === "flowing" ? "13" : "14";
  input("length").step = style ? "2" : "1";
  document
    .querySelectorAll<HTMLButtonElement>("[data-mood]")
    .forEach((b) => (b.disabled = Boolean(style)));
}
syncEngine();
select("engine").onchange = () => syncEngine(true);
$("#panel-explore").addEventListener("change", () => {
  try {
    syncProfile();
    savePreferences();
  } catch (error) {
    showError((error as Error).message);
  }
});
function showError(message: string) {
  $("#notice").hidden = false;
  $("#notice").textContent = message;
}
function status(text: string) {
  $("#run-status").textContent = text;
}
type RunState = "idle" | "running" | "paused" | "done" | "error" | "offline";
function runState(state: RunState) {
  $("#stage").dataset.state = state;
  if (state === "done") meter(1);
}
function meter(fraction?: number) {
  const total = activeSearch?.count || 0;
  $("#meter").style.width =
    (fraction ?? (total ? Math.min(1, rows.size / total) : 0)) * 100 + "%";
}
function setRank(page: number, count: number) {
  $("#results").style.counterReset = `rank ${(page - 1) * count}`;
}
function setBusy(value: boolean) {
  running = value;
  $("#pause").hidden = !value;
  $("#resume").hidden = value || !paused;
  $<HTMLButtonElement>("#generate").disabled = false;
}
function updateSavedButtons() {
  $("#saved-count").textContent = String(Object.keys(saved).length);
  document
    .querySelectorAll<HTMLButtonElement>("[data-save]")
    .forEach((button) => {
      const yes = Boolean(saved[button.dataset.save!]);
      button.setAttribute("aria-pressed", String(yes));
      button.setAttribute(
        "aria-label",
        `${yes ? "Remove" : "Save"} ${button.dataset.name}${yes ? " from shortlist" : " to shortlist"}`,
      );
    });
}
function nameCard(domain: string, row?: DomainRow): HTMLLIElement {
  const name = domain[0].toUpperCase() + domain.slice(1, -4),
    li = document.createElement("li");
  li.dataset.domain = domain;
  li.className = "name-card";
  const title = document.createElement("h3");
  title.textContent = name;
  const sub = document.createElement("span");
  sub.className = "domain";
  sub.textContent = ".com";
  const badge = document.createElement("span"),
    state =
      row?.status === "possibly available"
        ? "available"
        : row?.status === "registered"
          ? "registered"
          : "unchecked";
  li.dataset.status = state;
  badge.className = "domain-status " + state;
  badge.textContent = row?.status || "not checked";
  badge.title = row
    ? `${row.source} · ${new Date(row.checkedAt).toLocaleString()}`
    : "No lookup has been made";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "save-name";
  button.dataset.save = domain;
  button.dataset.name = name;
  button.onclick = () => {
    if (saved[domain]) delete saved[domain];
    else saved[domain] = { name, domain, addedAt: Date.now() };
    storageSet(savedKey, JSON.stringify(saved));
    updateSavedButtons();
    renderSaved();
  };
  li.append(title, sub, badge, button);
  return li;
}
function renderInitial(names: string[], checking = false) {
  rows.clear();
  const list = $("#results");
  list.replaceChildren(...names.map((n) => nameCard(n.toLowerCase() + ".com")));
  if (checking)
    list.querySelectorAll(".domain-status").forEach((el) => {
      el.textContent = "checking…";
      el.className = "domain-status checking";
      (el.parentElement as HTMLElement).dataset.status = "checking";
    });
  $("#result-count").textContent = String(names.length);
  updateSavedButtons();
}
function addRow(row: DomainRow) {
  rows.set(row.domain, row);
  const old = Array.from($("#results").children).find(
    (el) => (el as HTMLElement).dataset.domain === row.domain,
  );
  const card = nameCard(row.domain, row);
  if (old) old.replaceWith(card);
  else $("#results").append(card);
  $("#result-count").textContent = String($("#results").children.length);
  updateSavedButtons();
  meter();
}
function renderSaved() {
  const list = $("#saved-list");
  list.replaceChildren(
    ...Object.keys(saved).map((domain) => nameCard(domain, rows.get(domain))),
  );
  if (!Object.keys(saved).length) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent =
      "A good name deserves a second look. Tap a heart to keep one here.";
    list.append(li);
  }
  updateSavedButtons();
}
function cancel() {
  requestId++;
  if (running) lookup.postMessage({ type: "pause" });
  paused = Boolean(activeSearch);
  setBusy(false);
}
async function requestPersistence() {
  try {
    const persisted = await navigator.storage?.persist?.();
    $("#cache-status").textContent =
      `Cache storage: ${persisted ? "persistent permission granted" : "best effort"}. Shortlist backups are downloadable separately.`;
  } catch {
    /* IDB errors are reported by the worker */
  }
}
function beginSearch(search: SearchState, refresh = false) {
  if (search.filtered) {
    rows.clear();
    $("#results").replaceChildren();
    $("#result-count").textContent = "0";
  } else
    renderInitial(generate(search.settings, search.count, search.page), true);
  $("#page-label").textContent = `Page ${search.page}`;
  setRank(search.page, search.count);
  activeSearch = search;
  paused = false;
  requestId++;
  storageSet(activeKey, JSON.stringify(search));
  setBusy(true);
  runState("running");
  meter();
  lookup.postMessage({ type: "search", id: requestId, ...search, refresh });
}
function run() {
  try {
    const s = settings(),
      count = Number(select("count").value),
      page = number("page");
    if (![24, 50, 200, 1000, 4000].includes(count))
      throw new Error("Choose a result count");
    if (!Number.isInteger(page) || page < 1)
      throw new Error("Page must be a positive integer");
    const names = generate(s, count, page);
    cancel();
    $("#notice").hidden = true;
    paused = false;
    activeSearch = undefined;
    storageSet(activeKey, null);
    $("#resume").hidden = true;
    renderInitial(names, input("check-domains").checked);
    setRank(page, count);
    runState("idle");
    $("#page-label").textContent = `Page ${page}`;
    $<HTMLButtonElement>("#previous").disabled = page === 1;
    savePreferences();
    if (!input("check-domains").checked) {
      status(`${names.length} names generated offline. Domain checks are off.`);
      return;
    }
    if (!navigator.onLine) {
      status(
        `${names.length} names generated offline. Reconnect and resume to check domains.`,
      );
      activeSearch = {
        settings: s,
        count,
        page,
        filtered: input("filter-available").checked,
        options: options(),
      };
      paused = true;
      storageSet(activeKey, JSON.stringify(activeSearch));
      $("#resume").hidden = false;
      runState("offline");
      return;
    }
    const search = {
      settings: s,
      count,
      page,
      filtered: input("filter-available").checked,
      options: options(),
    };
    if (search.filtered) {
      $("#results").replaceChildren();
      $("#result-count").textContent = "0";
    }
    status(
      search.filtered
        ? "Finding RDAP-confirmed possibilities in seed order…"
        : "Checking .com domains in seed order…",
    );
    beginSearch(search, input("refresh").checked);
    input("refresh").checked = false;
    void requestPersistence();
  } catch (error) {
    showError((error as Error).message);
  }
}
$("#generate-form").onsubmit = (event) => {
  event.preventDefault();
  run();
};
$("#pause").onclick = () => {
  cancel();
  runState("paused");
  status("Paused. Completed checks and search progress are saved.");
};
$("#resume").onclick = () => {
  if (activeSearch && navigator.onLine) {
    status("Resuming saved progress…");
    beginSearch(activeSearch);
  } else status("Reconnect to resume domain checks.");
};
$("#next").onclick = () => {
  input("page").value = String(number("page") + 1);
  run();
};
$("#previous").onclick = () => {
  input("page").value = String(Math.max(1, number("page") - 1));
  run();
};
lookup.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "cache") {
    const s = msg.stats;
    $("#cache-status").textContent =
      `${s.domains} domain records · ${s.dns} DNS records · ${s.sessions} searches · ${s.matches} saved search results. Shortlist retained.`;
    return;
  }
  if (msg.id !== requestId) return;
  if (msg.type === "row") addRow(msg.row);
  else if (msg.type === "progress")
    status(
      `${msg.cursor.toLocaleString()} candidates checked${msg.matches !== undefined ? " · " + msg.matches.toLocaleString() + " possible matches" : ""}. RDAP ${msg.stats.rdap} · DNS ${msg.stats.dns} · ${msg.stats.skipped} RDAP checks skipped.`,
    );
  else if (msg.type === "done") {
    paused = false;
    activeSearch = undefined;
    storageSet(activeKey, null);
    setBusy(false);
    runState("done");
    status(
      `${msg.emitted} results · ${msg.cursor.toLocaleString()} candidates${msg.matches !== undefined ? " · " + msg.matches + " possible matches" : ""}. RDAP ${msg.stats.rdap} · DNS ${msg.stats.dns} · ${msg.stats.skipped} skipped · ${msg.stats.cacheHits} cached.`,
    );
  } else if (msg.type === "paused") {
    paused = Boolean(activeSearch);
    setBusy(false);
    runState("paused");
    status("Paused. Resume to continue from saved progress.");
  } else if (msg.type === "error") {
    paused = Boolean(activeSearch);
    setBusy(false);
    runState("error");
    status(msg.error);
    $("#results")
      .querySelectorAll(".checking")
      .forEach((el) => {
        el.textContent = "not confirmed";
        el.className = "domain-status error";
        (el.parentElement as HTMLElement).dataset.status = "error";
      });
  }
};
lookup.onerror = () => {
  paused = Boolean(activeSearch);
  setBusy(false);
  runState("error");
  status("The lookup worker stopped. Reload and resume the saved search.");
};
$("#inspect-cache").onclick = () =>
  lookup.postMessage({ type: "stats", id: requestId });
$("#clear-cache").onclick = () => {
  cancel();
  lookup.postMessage({ type: "clear", id: requestId });
};
function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#backup").onclick = () => {
  download(
    "brand-name-shortlist.json",
    JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        saved,
        preferences: JSON.parse(storageGet(prefKey) || "{}"),
      },
      null,
      2,
    ),
  );
  $("#saved-status").textContent =
    "Backup download started. Keep this file outside browser storage.";
};
input("import").onchange = async () => {
  const file = input("import").files?.[0];
  if (!file) return;
  try {
    if (file.size > 5000000)
      throw new Error("Backup must be smaller than 5 MB");
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !validSaved(data.saved))
      throw new Error("This is not a valid shortlist backup");
    saved = { ...saved, ...data.saved };
    storageSet(savedKey, JSON.stringify(saved));
    renderSaved();
    $("#saved-status").textContent =
      `Imported. ${Object.keys(saved).length} saved names.`;
  } catch (error) {
    $("#saved-status").textContent = (error as Error).message;
  }
  input("import").value = "";
};
$("#export-results").onclick = () => {
  const header = "domain,status,source,checked_at_utc\n",
    csv = Array.from($("#results").children)
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
  download("brand-name-results.csv", header + csv, "text/csv");
};
function switchTab(id: string) {
  document
    .querySelectorAll<HTMLButtonElement>("[data-tab]")
    .forEach((button) => {
      const selected = button.dataset.tab === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      $("#panel-" + button.dataset.tab).hidden = !selected;
    });
  if (id === "saved") renderSaved();
}
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
  button.onclick = () => switchTab(button.dataset.tab!);
  button.onkeydown = (e) => {
    const tabs = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-tab]"),
      ),
      index = tabs.indexOf(button);
    let next;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      switchTab(tabs[next].dataset.tab!);
      tabs[next].focus();
    }
  };
});
function displayAnalysis(container: HTMLElement, result: any) {
  container.replaceChildren();
  const summary = document.createElement("p");
  summary.className = "analysis-summary";
  summary.textContent =
    result.status === "gap"
      ? "This reading has a representation gap."
      : result.status === "fit"
        ? "Candidate settings found."
        : result.results
          ? "Nearby allowed spellings"
          : "Candidate inverse settings";
  container.append(summary);
  if (result.source) {
    const p = document.createElement("p");
    p.textContent = `${result.source} · ${result.phones.join(" ")}`;
    container.append(p);
  }
  if (result.structure) {
    const p = document.createElement("p");
    p.className = "fine-print";
    p.textContent = Object.entries(result.structure)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
    container.append(p);
  }
  for (const gap of result.gaps || []) {
    const p = document.createElement("p");
    p.className = "gap";
    p.textContent = gap;
    container.append(p);
  }
  const candidates =
    result.candidates ||
    result.results ||
    result.fits?.map(([score, dials]: [number, any]) => ({ dials, score }));
  for (const item of candidates || []) {
    const card = document.createElement("article");
    card.className = "analysis-card";
    const title = document.createElement("h3");
    title.textContent =
      item.word ||
      Object.entries(item.dials)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ");
    card.append(title);
    if (item.samples) {
      const p = document.createElement("p");
      p.textContent = item.samples.join(" · ");
      card.append(p);
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Explore these settings";
      b.onclick = () => {
        switchTab("explore");
        select("engine").value = "";
        syncEngine();
        setMood(item.nearest_recipe);
        for (const d of DIALS) {
          input(d).value = String(item.dials[d]);
          input(d).dataset.explicit = "true";
        }
        for (const key of ["length", "syllables", "opening", "ending"]) {
          const el = document.getElementById(key) as HTMLInputElement;
          el.value = String(result.structure[key]);
        }
        input("page").value = "1";
        input("check-domains").checked = false;
        syncProfile();
        run();
      };
      card.append(b);
    }
    if (item.phones) {
      const p = document.createElement("p");
      p.textContent = `${item.phones.join(" ")} · edit cost ${item.sound_edit_cost}`;
      card.append(p);
      for (const edit of [...item.edits, ...item.structure_changes]) {
        const line = document.createElement("p");
        line.className = "fine-print";
        line.textContent = edit;
        card.append(line);
      }
    }
    container.append(card);
  }
  const details = document.createElement("details"),
    label = document.createElement("summary"),
    pre = document.createElement("pre");
  label.textContent = "Full report and reading notes";
  pre.textContent = JSON.stringify(result, null, 2);
  details.append(label, pre);
  container.append(details);
}
document.querySelectorAll<HTMLFormElement>(".tool-form").forEach((form) => {
  const modeSelect = form.elements.namedItem(
      "reading-mode",
    ) as HTMLSelectElement | null,
    value = form.elements.namedItem("reading-value") as HTMLInputElement | null;
  if (modeSelect && value) {
    value.disabled = true;
    modeSelect.onchange = () => {
      value.disabled = modeSelect.value === "dictionary";
      value.required = !value.disabled;
    };
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (analysisBusy || !form.reportValidity()) return;
    analysisBusy = true;
    document
      .querySelectorAll<HTMLButtonElement>(".tool-form button")
      .forEach((b) => (b.disabled = true));
    const panel = form.closest("section")!,
      output = panel.querySelector<HTMLElement>(".tool-result")!,
      line = panel.querySelector<HTMLElement>(".tool-status")!,
      button = form.querySelector<HTMLButtonElement>("button")!;
    line.textContent = "Exploring the sound model…";
    button.disabled = true;
    panel.dataset.busy = "true";
    if (!analysisWorker)
      analysisWorker = new Worker(
        new URL("./analysis.worker.ts", import.meta.url),
        { type: "module" },
      );
    const data = new FormData(form),
      readingMode = String(data.get("reading-mode")),
      id = ++analysisId;
    analysisWorker.onmessage = (e) => {
      if (e.data.id !== id) return;
      analysisBusy = false;
      delete panel.dataset.busy;
      document
        .querySelectorAll<HTMLButtonElement>(".tool-form button")
        .forEach((b) => (b.disabled = false));
      if (e.data.error) line.textContent = e.data.error;
      else {
        line.textContent = "Analysis complete. No domain lookups were made.";
        displayAnalysis(output, e.data.result);
      }
    };
    analysisWorker.onerror = () => {
      analysisBusy = false;
      delete panel.dataset.busy;
      document
        .querySelectorAll<HTMLButtonElement>(".tool-form button")
        .forEach((b) => (b.disabled = false));
      line.textContent =
        "Analysis could not load. If offline, supply engine spelling or open this tool once while online.";
      analysisWorker?.terminate();
      analysisWorker = undefined;
    };
    analysisWorker.postMessage({
      id,
      mode: form.dataset.mode,
      word: String(data.get("word")),
      seed: input("seed").value,
      count: Number(data.get("suggestion-count") || 5),
      ...(readingMode === "reading"
        ? { reading: String(data.get("reading-value")) }
        : readingMode === "phones"
          ? { phones: String(data.get("reading-value")) }
          : {}),
    });
  };
});
let resumeOnVisible = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    resumeOnVisible = true;
    cancel();
  } else if (
    !document.hidden &&
    resumeOnVisible &&
    activeSearch &&
    navigator.onLine
  ) {
    resumeOnVisible = false;
    beginSearch(activeSearch);
  }
});
window.addEventListener("offline", () => {
  if (running) {
    resumeOnVisible = true;
    cancel();
    runState("offline");
    status("Offline. Generation still works; checked progress is saved.");
  }
});
window.addEventListener("online", () => {
  if (resumeOnVisible && !document.hidden && activeSearch) {
    resumeOnVisible = false;
    beginSearch(activeSearch);
  }
});
window.addEventListener("pagehide", () => {
  if (running) lookup.postMessage({ type: "pause" });
});
function network() {
  $("#net").dataset.online = String(navigator.onLine);
  $("#net-label").textContent = navigator.onLine ? "online" : "offline";
}
network();
window.addEventListener("online", network);
window.addEventListener("offline", network);
try {
  syncProfile();
  renderInitial(
    generate(settings(), Number(select("count").value), number("page")),
  );
  setRank(number("page"), Number(select("count").value));
  $("#page-label").textContent = `Page ${number("page")}`;
} catch {
  setMood("calm");
  input("length").value = "6";
  input("page").value = "1";
  renderInitial(generate({}, 24));
}
runState("idle");
// Web fonts after the first results frame (see style.css); cached visits
// already enabled them in <head>.
requestAnimationFrame(() =>
  setTimeout(() => {
    document.documentElement.classList.add("fonts");
    Promise.all(
      ["500 1em Funnel Display", "1em Inter", "1em BNE Mono"].map((f) =>
        document.fonts.load(f),
      ),
    ).then(
      () => localStorage.setItem("bne.fonts.v1", "1"),
      () => {},
    );
  }),
);
renderSaved();
try {
  const pending = JSON.parse(storageGet(activeKey) || "null");
  if (pending?.settings && pending.count && pending.page) {
    activeSearch = pending;
    paused = true;
    $("#resume").hidden = false;
    runState("paused");
    status(
      "A previous search is saved. Resume its checks, or generate a new set.",
    );
  }
} catch {
  /* no saved search */
}
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js", {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .catch(() => {});
  });
