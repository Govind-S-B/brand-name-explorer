import { Feed } from "./feed";
import {
  CONTROL_IDS,
  HISTORY_KEY,
  APP_SETTINGS_KEY,
  addHistory,
  readHistory,
  readAppSettings,
  freshSeed,
  freshMood,
  type Controls,
  type HistoryEntry,
} from "./history";
import {
  nameFrom,
  nameKey,
  rowName,
  renderName,
  updateNameStatus,
  mark,
  validSaved,
  type Name,
  type Reading,
  type SavedName,
} from "./name-row";
import "./style.css";
import {
  MOODS,
  DIALS,
  FRONT,
  resolveProfile,
  type Settings,
  type Ending,
  type Opening,
} from "../../core/profile";
import type { DomainRow } from "../../lookup/store";
import { DEFAULT_LOOKUP, type LookupOptions } from "../../lookup/engine";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
// Same-text writes are skipped so static first-paint text is not repainted.
const setText = (e: HTMLElement, text: string) => {
  if (e.textContent !== text) e.textContent = text;
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
let mood = "calm",
  rows = new Map<string, DomainRow>(),
  saved: Record<string, SavedName> = {},
  running = false,
  paused = false,
  requestId = 0,
  activeSearch: SearchState | undefined,
  lastSearch: SearchState | undefined,
  lastControls: Controls | undefined,
  checksOn = true,
  pageStart = 0,
  pageDone = 0,
  dirty = false,
  userScrolled = false,
  resumeOnVisible = false,
  toastTimer: ReturnType<typeof setTimeout> | undefined;
interface SearchState {
  settings: Settings;
  count: number;
  page: number;
  filtered: boolean;
  options: Partial<LookupOptions>;
}
// v2: defaults now follow the CLI (available names only, 20 per page).
const prefKey = "bne.preferences.v2",
  savedKey = "bne.shortlist.v1",
  list = $("#results");
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
    showError(
      "Browser storage is unavailable. History and settings may be lost on reload. Download a shortlist backup to keep saved names.",
    );
    return false;
  }
}
let appSettings = readAppSettings(storageGet(APP_SETTINGS_KEY));
let searchHistory = readHistory(storageGet(HISTORY_KEY));
try {
  const value = JSON.parse(storageGet(savedKey) || "{}");
  if (validSaved(value)) saved = value;
} catch {
  /* retain an empty, exportable shortlist */
}
const lookup = new Worker(new URL("./lookup.worker.ts", import.meta.url), {
  type: "module",
});
let detailId = 0,
  lookupFailed = false;
const domainChecks = new Map<
  string,
  { id: number; pending: boolean; error?: string }
>();
function rememberRow(row: DomainRow) {
  const previous = rows.get(row.domain);
  if (!previous || row.checkedAt >= previous.checkedAt)
    rows.set(row.domain, row);
}
// Analysis views and rare actions load on first use (see analysis-ui.ts).
const ui = () => import("./analysis-ui");
const input = (id: string) => $<HTMLInputElement>("#" + id),
  select = (id: string) => $<HTMLSelectElement>("#" + id),
  number = (id: string) => Number(input(id).value);
function settings(): Settings {
  if (!/^-?\d+$/.test(input("seed").value))
    throw new Error("Seed must be an integer");
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
  const blend = select("blend").value,
    custom = DIALS.some((d) => input(d).dataset.explicit === "true"),
    profile = resolveProfile({
      mood,
      ...(blend ? { blend: blend + ":" + input("blend-amount").value } : {}),
    }),
    label = cap(mood) + (blend ? " + " + cap(blend) : "");
  for (const d of DIALS) {
    if (input(d).dataset.explicit !== "true")
      input(d).value = String(profile[d]);
    $("#" + d + "-value").textContent = input(d).value;
  }
  $("#blend-amount-value").textContent = input("blend-amount").value;
  input("blend-amount").disabled = !blend;
  $("#mood-swatch").className = "swatch mood-" + mood;
  setText($("#mood-label"), mood);
  $("#mood-picker").setAttribute(
    "aria-label",
    `${mood}: tune mood and settings`,
  );
  setText($("#mood-summary"), label);
  // A mood picked from the extra list gets its own selected chip in the row;
  // "+ More" stays a separate control that only opens and closes the list.
  const extra = !FRONT.includes(mood);
  $("#extra-mood").hidden = !extra;
  setText($("#extra-mood-label"), cap(mood));
  $("#extra-mood-swatch").className = "swatch mood-" + mood;
  setText(
    $("#sound-summary"),
    `${custom ? "Custom dials" : "From mood"} · ${select("syllables").value || "auto"} syllables`,
  );
  setText($("#spelling-summary"), input("length").value + " letters");
  setText(
    $("#domain-summary"),
    !input("check-domains").checked
      ? "Off"
      : input("filter-available").checked
        ? "Available only"
        : "All names",
  );
  setText(
    $("#advanced-summary"),
    `${select("count").value} per page · seed ${input("seed").value}`,
  );
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
function captureControls(): Controls {
  const values: Controls = { mood };
  for (const id of CONTROL_IDS) {
    const field = input(id);
    values[id] = field.type === "checkbox" ? field.checked : field.value;
  }
  values.explicit = DIALS.filter(
    (d) => input(d).dataset.explicit === "true",
  ).join(",");
  return values;
}
function savePreferences() {
  storageSet(prefKey, JSON.stringify(captureControls()));
}
function recordSearch(
  source: string,
  controls: Controls,
  reverse?: HistoryEntry["reverse"],
) {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    source,
    controls,
    fresh: input("refresh").checked,
    ...(reverse ? { reverse } : {}),
  };
  const stored = storageGet(HISTORY_KEY);
  searchHistory = addHistory(
    stored === null ? searchHistory : readHistory(stored),
    entry,
  );
  storageSet(HISTORY_KEY, JSON.stringify(searchHistory));
  if (historySheet.open) void renderSearchHistory();
}
function applyControls(prefs: Controls) {
  for (const id of CONTROL_IDS) {
    const field = input(id),
      value = prefs[id];
    if (field.type === "checkbox" && typeof value === "boolean")
      field.checked = value;
    else if (typeof value === "string") field.value = value;
  }
  if (typeof prefs.mood === "string" && Object.hasOwn(MOODS, prefs.mood))
    mood = prefs.mood;
  for (const d of DIALS) {
    delete input(d).dataset.explicit;
    if (
      String(prefs.explicit || "")
        .split(",")
        .includes(d)
    )
      input(d).dataset.explicit = "true";
  }
  document
    .querySelectorAll<HTMLElement>("[data-mood]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mood === mood)),
    );
}
try {
  applyControls(JSON.parse(storageGet(prefKey) || "{}"));
} catch {
  /* use defaults */
}
if (appSettings.randomSeed) {
  input("seed").value = freshSeed(input("seed").value);
  input("page").value = "1";
  select("blend").value = "";
  setMood(freshMood(mood));
}
$("#more-moods-toggle").onclick = () => {
  const list = $("#more-moods");
  list.hidden = !list.hidden;
  $("#more-moods-toggle").setAttribute("aria-expanded", String(!list.hidden));
};
document.querySelectorAll<HTMLButtonElement>("[data-mood]").forEach((b) => {
  b.setAttribute("aria-pressed", String(b.dataset.mood === mood));
  b.onclick = () => {
    setMood(b.dataset.mood!);
    // Picking from the extra list closes it; the chip then names the choice.
    if (b.closest("#more-moods")) {
      $("#more-moods").hidden = true;
      $("#more-moods-toggle").setAttribute("aria-expanded", "false");
      $("#more-moods-toggle").focus({ preventScroll: true });
    }
    input("page").value = "1";
    savePreferences();
    dirty = true;
  };
});
for (const d of DIALS)
  input(d).oninput = () => {
    input(d).dataset.explicit = "true";
    $("#" + d + "-value").textContent = input(d).value;
  };
$("#reset-dials").onclick = () => {
  for (const d of DIALS) delete input(d).dataset.explicit;
  syncProfile();
  savePreferences();
  dirty = true;
};
document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(
  (b) =>
    (b.onclick = () => {
      const field = input("length"),
        step = Number(field.step) || 1,
        next = number("length") + Number(b.dataset.step) * step;
      if (next >= Number(field.min) && next <= Number(field.max)) {
        field.value = String(next);
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }),
);
$("#panel-explore").addEventListener("change", (event) => {
  try {
    syncProfile();
    savePreferences();
    if ((event.target as Element).closest("#tune")) dirty = true;
  } catch (error) {
    showError((error as Error).message);
  }
});

// Tune: a modal bottom sheet on phones, an inline panel on desktop.
const tune = $<HTMLDialogElement>("#tune"),
  wide = matchMedia("(min-width: 900px)");
function openTune() {
  ($("#mood-controls") as HTMLDetailsElement).open = true;
  if (!tune.open) wide.matches ? tune.show() : tune.showModal();
  $("#mood-picker").setAttribute("aria-expanded", "true");
}
tune.onclose = () => {
  $("#mood-picker").setAttribute("aria-expanded", "false");
  $("#mood-picker").focus({ preventScroll: true });
  if (dirty) run();
};
tune.onkeydown = (e) => {
  if (e.key === "Escape" && !tune.matches(":modal")) tune.close();
};
$("#mood-picker").onclick = () => (tune.open ? tune.close() : openTune());
$("#generate-form").onsubmit = (event) => {
  event.preventDefault();
  dirty = false;
  tune.close();
  run(false, "Show names");
};
document
  .querySelectorAll<HTMLElement>("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog")!.close()));
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d && d.matches(":modal")) d.close();
  }),
);

const historySheet = $<HTMLDialogElement>("#history-sheet"),
  settingsSheet = $<HTMLDialogElement>("#settings-sheet");
const historyUi = () => import("./history-ui");
let historyRevision = 0,
  rerunningHistory = false;
let historyTimer: ReturnType<typeof setInterval> | undefined;
async function renderSearchHistory() {
  const revision = ++historyRevision,
    module = await historyUi();
  if (revision !== historyRevision || !historySheet.open) return;
  module.renderHistory(
    $("#history-list"),
    searchHistory,
    input("history-filter").value,
    runHistoryAgain,
  );
}
$("#open-history").onclick = () => {
  const stored = storageGet(HISTORY_KEY);
  if (stored !== null) searchHistory = readHistory(stored);
  input("history-filter").value = "";
  historySheet.showModal();
  void renderSearchHistory();
  historyTimer = setInterval(() => {
    void historyUi().then((m) => m.updateTimes($("#history-list")));
  }, 30000);
};
input("history-filter").oninput = () => {
  void renderSearchHistory();
};
historySheet.onclose = () => {
  if (historySheet.open) return;
  historyRevision++;
  clearInterval(historyTimer);
  $("#history-list").replaceChildren();
  if (!rerunningHistory) $("#open-history").focus({ preventScroll: true });
  rerunningHistory = false;
};
function runHistoryAgain(entry: HistoryEntry) {
  rerunningHistory = true;
  historySheet.close();
  applyControls(entry.controls);
  input("refresh").checked = entry.fresh;
  syncProfile();
  savePreferences();
  dirty = false;
  if (entry.reverse) {
    input("reverse-word").value = entry.reverse.word;
    modeSelect.value = entry.reverse.mode;
    readingValue.value = entry.reverse.value;
    modeSelect.dispatchEvent(new Event("change"));
    switchTab("reverse");
    analyseReverse("reverse", "Reverse run again");
    input("reverse-word").focus({ preventScroll: true });
  } else {
    switchTab("explore");
    void run(false, "Run again");
    $("#tab-explore").focus({ preventScroll: true });
  }
}
$("#open-settings").onclick = () => {
  input("random-seed").checked = appSettings.randomSeed;
  $("#history-storage-status").textContent =
    `${searchHistory.length} saved searches.`;
  settingsSheet.showModal();
};
settingsSheet.onclose = () => {
  if (!settingsSheet.open) $("#open-settings").focus({ preventScroll: true });
};
input("random-seed").onchange = () => {
  appSettings.randomSeed = input("random-seed").checked;
  storageSet(APP_SETTINGS_KEY, JSON.stringify(appSettings));
};
$("#clear-history").onclick = () => {
  if (!storageSet(HISTORY_KEY, "[]")) return;
  searchHistory = [];
  $("#history-storage-status").textContent =
    "History cleared. New searches will appear automatically.";
};
addEventListener("storage", (event) => {
  if (event.key === HISTORY_KEY) {
    searchHistory = readHistory(event.newValue);
    if (historySheet.open) void renderSearchHistory();
  }
});

function showError(message: string) {
  $("#notice").hidden = false;
  $("#notice").textContent = message;
}
function toast(message: string) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
function status(text: string) {
  setText($("#run-status"), text);
}
type RunState = "idle" | "running" | "paused" | "done" | "error" | "offline";
function runState(state: RunState) {
  $("#stage").dataset.state = state;
  if (state === "done" || state === "idle") requestAnimationFrame(endOfFeed);
}
/**
 * The feed loads its next page when its end scrolls into view. If the end is
 * already on screen when a page finishes (a short list on a tall window), the
 * next page loads straight away so the screen fills; a page that added
 * nothing stops there.
 */
function endOfFeed() {
  const state = $("#stage").dataset.state;
  if (
    !running &&
    (state === "done" || state === "idle") &&
    !$("#panel-explore").hidden &&
    !document.hidden &&
    feed.length > pageStart &&
    $("#feed-end").getBoundingClientRect().top < innerHeight
  )
    run(true);
}
function meter() {
  $("#meter").style.width =
    Math.min(1, pageDone / (activeSearch?.count || 1)) * 100 + "%";
}
function setBusy(value: boolean) {
  running = value;
  $("#pause").hidden = !value;
  $("#resume").hidden = value || !paused;
}
const onPage = (page: number) => (page > 1 ? ` · page ${page}` : "");
function summarizeFeed(
  filtered = lastSearch?.filtered,
  page = lastSearch?.page || 1,
) {
  const available = feed.domains.filter(
    (domain) => rows.get(domain)?.status === "possibly available",
  ).length;
  status(
    filtered && available === feed.length
      ? `${feed.length} possibly available .com names${onPage(page)}`
      : `${feed.length} names · ${available} possibly available${onPage(page)}`,
  );
}

// Feed rows. Clicks are delegated: the heart saves, the name opens the sheet.
function updateSavedButtons(root: ParentNode = document) {
  const n = Object.keys(saved).length;
  $("#saved-count").textContent = String(n);
  $("#saved-count").dataset.n = String(n);
  $("#tab-saved").setAttribute("aria-label", `Shortlist ${n} saved`);
  root.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((button) => {
    const yes = Boolean(saved[button.dataset.save!]);
    button.setAttribute("aria-pressed", String(yes));
    // The sheet's button is named by its visible "Save"/"Saved" label.
    if (button.id !== "ns-save")
      button.setAttribute(
        "aria-label",
        `${yes ? "Remove" : "Save"} ${button.dataset.name}${yes ? " from shortlist" : " to shortlist"}`,
      );
  });
  setText(
    $("#ns-save span"),
    activeView && saved[nameKey(activeView.item)] ? "Saved" : "Save",
  );
}
function nameCard(value: Name | string, reading?: Reading): HTMLLIElement {
  const item = typeof value === "string" ? nameFrom(value, reading) : value;
  const card = renderName(
    item,
    item.domain ? rows.get(item.domain) : undefined,
    Boolean(saved[nameKey(item)]),
  );
  if (item.domain && domainChecks.has(item.domain)) updateCardStatus(card);
  return card;
}
function discoveryCard(value: Name | string, reading?: Reading) {
  const card = nameCard(value, reading);
  card.dataset.autoCheck = "";
  // Analysis builds lists synchronously; wait until their rows are attached.
  queueMicrotask(() => checkList(card));
  return card;
}
function checkList(root: ParentNode = document) {
  const cards =
    root instanceof HTMLElement && root.matches("[data-auto-check]")
      ? [root]
      : [...root.querySelectorAll<HTMLElement>("[data-auto-check]")];
  for (const card of cards)
    if (
      card.isConnected &&
      !card.closest("[hidden]") &&
      (!card.closest("dialog") || sheet.open) &&
      card.dataset.domain
    )
      checkDomain(card.dataset.domain, false);
}
function updateCardStatus(card: HTMLElement) {
  const domain = card.dataset.domain!,
    row = rows.get(domain),
    check = domainChecks.get(domain);
  if (check?.pending || (check?.error && !row)) {
    const badge = card.querySelector<HTMLElement>(".domain-status")!;
    mark(
      card,
      badge,
      check.pending ? "checking" : "error",
      check.pending ? "checking…" : "not confirmed",
    );
    badge.title = check.error || "Checking .com availability";
  } else updateNameStatus(card, row);
}
function syncNameStatuses(domain?: string) {
  document
    .querySelectorAll<HTMLElement>(
      domain
        ? `.name-card[data-domain="${domain}"]`
        : ".name-card[data-domain]",
    )
    .forEach((card) => {
      if (
        rows.has(card.dataset.domain!) ||
        domainChecks.has(card.dataset.domain!)
      )
        updateCardStatus(card);
    });
  if (sheet.open && (!domain || activeView?.item.domain === domain))
    updateNameDetails();
}
const feed = new Feed(
  list,
  (domain) => {
    const card = nameCard(nameFrom(domain.slice(0, -4)));
    if (!rows.has(domain) && activeSearch && !activeSearch.filtered && running)
      mark(
        card,
        card.querySelector(".domain-status")!,
        "checking",
        "checking…",
      );
    return card;
  },
  () => updateSavedButtons(list),
);
function trim() {
  feed.truncate(pageStart);
}
function renderNames(names: string[], _checking: boolean) {
  for (const name of names) feed.add(name.toLowerCase() + ".com");
}
function addRow(row: DomainRow) {
  rememberRow(row);
  feed.update(row.domain);
  syncNameStatuses(row.domain);
  pageDone++;
  meter();
}
function toggleSave(item: Name) {
  const key = nameKey(item);
  if (saved[key]) delete saved[key];
  else saved[key] = { ...item, addedAt: Date.now() };
  storageSet(savedKey, JSON.stringify(saved));
  updateSavedButtons();
}
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement,
    save = target.closest<HTMLElement>("[data-save]"),
    open = target.closest<HTMLElement>(".name-open");
  if (save) {
    const item = rowName(save) || activeView?.item;
    if (!item) return;
    toggleSave(item);
    save.classList.remove("pop");
    void save.offsetWidth;
    save.classList.add("pop");
    if (save.closest("#saved-list")) renderSaved();
  } else if (open) {
    const item = rowName(open);
    if (item) openName(item, open);
  }
});
function renderSaved() {
  const domains = Object.keys(saved),
    saveList = $("#saved-list");
  saveList.replaceChildren(...domains.map((key) => discoveryCard(saved[key])));
  if (!domains.length) {
    const li = el("li", "empty-state"),
      browse = el("button", "secondary", "Browse names");
    li.append(
      el("i", "heart"),
      el("b", "", "Nothing saved yet"),
      "Tap the heart on any name to keep it here.",
      el("br"),
      browse,
    );
    browse.onclick = () => switchTab("explore");
    saveList.append(li);
  }
  updateSavedButtons();
}

// Searches. Each page keeps the worker's page/session semantics; the feed
// appends later pages so browsing reads as one continuous list.
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
      `Lookup cache storage: ${persisted ? "persistent" : "best effort"}.`;
  } catch {
    /* IDB errors are reported by the worker */
  }
}
async function beginSearch(search: SearchState, refresh = false) {
  const id = ++requestId;
  activeSearch = search;
  paused = false;
  pageDone = 0;
  setBusy(true);
  runState("running");
  try {
    trim();
    if (!search.filtered) {
      const names = await generateNames(search);
      if (id !== requestId) return;
      renderNames(names, true);
      feed.flush();
    }
    list.dataset.filtered = String(search.filtered);
    meter();
    lookup.postMessage({ type: "search", id, ...search, refresh });
  } catch (error) {
    if (id === requestId) {
      setBusy(false);
      showError((error as Error).message);
    }
  }
}
let generationEpoch = 0;
async function run(more = false, source = "Changed settings") {
  const token = ++generationEpoch;
  try {
    let search: SearchState;
    if (more && lastSearch)
      search = { ...lastSearch, page: lastSearch.page + 1 };
    else {
      const count = Number(select("count").value),
        page = number("page");
      if (![20, 50, 200, 1000, 4000].includes(count))
        throw new Error("Choose how many names per page");
      if (!Number.isInteger(page) || page < 1)
        throw new Error("Start page must be a positive whole number");
      checksOn = input("check-domains").checked;
      search = {
        settings: settings(),
        count,
        page,
        filtered: checksOn && input("filter-available").checked,
        options: options(),
      };
      savePreferences();
    }
    const controls = more && lastControls ? lastControls : captureControls();
    cancel();
    runState("running");
    const names =
      !checksOn || !navigator.onLine ? await generateNames(search) : [];
    if (token !== generationEpoch) return;
    dirty = false;
    $("#notice").hidden = true;
    activeSearch = undefined;
    lastSearch = search;
    lastControls = controls;
    recordSearch(more ? "More names" : source, {
      ...controls,
      page: String(search.page),
    });
    pageStart = more ? feed.length : 0;
    if (!more) {
      const retained = new Set(
        [
          ...document.querySelectorAll<HTMLElement>(
            "#panel-reverse .name-card[data-domain]",
          ),
        ].map((card) => card.dataset.domain),
      );
      for (const domain of rows.keys())
        if (
          !saved[domain] &&
          !retained.has(domain) &&
          !domainChecks.has(domain) &&
          activeView?.item.domain !== domain
        )
          rows.delete(domain);
    }
    if (!more) scrollTo({ top: 0 });
    if (!checksOn || !navigator.onLine) {
      trim();
      renderNames(names, false);
      feed.flush();
      list.dataset.filtered = "false";
      if (checksOn) {
        activeSearch = search;
        paused = resumeOnVisible = true;
        $("#resume").hidden = false;
        runState("offline");
        status("You’re offline. Showing unchecked names until you reconnect.");
      } else {
        runState("idle");
        status(
          `${feed.length} names · availability checks are off${onPage(search.page)}`,
        );
      }
      return;
    }
    status(
      search.filtered
        ? "Finding available .com names…"
        : "Checking .com availability…",
    );
    beginSearch(search, input("refresh").checked);
    input("refresh").checked = false;
    void requestPersistence();
  } catch (error) {
    showError((error as Error).message);
  }
}
$("#pause").onclick = () => {
  cancel();
  runState("paused");
  status("Paused. Progress is saved.");
};
$("#resume").onclick = () => {
  if (activeSearch && navigator.onLine) {
    status("Resuming…");
    beginSearch(activeSearch);
  } else status("Reconnect to resume checking.");
};
$("#next").onclick = () => run(true);
// Infinite scroll: once the reader has scrolled, reaching the end of the feed
// loads the next page. Wheel, touch and keyboard scrolling all count.
addEventListener("wheel", () => (userScrolled = true), { passive: true });
addEventListener("touchmove", () => (userScrolled = true), { passive: true });
addEventListener("scroll", () => scrollY > 0 && (userScrolled = true), {
  passive: true,
});
new IntersectionObserver(([entry]) => {
  if (
    entry.isIntersecting &&
    userScrolled &&
    !running &&
    ["done", "idle"].includes($("#stage").dataset.state!)
  )
    run(true);
}).observe($("#feed-end"));
let generationId = 0;
const generations = new Map<
  number,
  { resolve: (names: string[]) => void; reject: (error: Error) => void }
>();
function generateNames(search: SearchState): Promise<string[]> {
  const id = ++generationId;
  return new Promise((resolve, reject) => {
    generations.set(id, { resolve, reject });
    lookup.postMessage({
      type: "generate",
      id,
      settings: search.settings,
      count: search.count,
      page: search.page,
    });
  });
}
lookup.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "cached" || msg.type === "checked") {
    if (msg.type === "checked") {
      const check = domainChecks.get(msg.domain);
      if (!check || check.id !== msg.id) return;
      check.pending = false;
      check.error = msg.error
        ? !navigator.onLine
          ? "You’re offline. Reconnect, then retry."
          : msg.error.replace(/ Progress saved; resume to retry\.$/, "")
        : undefined;
      if (!check.error) domainChecks.delete(msg.domain);
    }
    if (msg.row) rememberRow(msg.row);
    syncNameStatuses(msg.domain);
    if (
      msg.row &&
      $("#stage").dataset.state === "done" &&
      feed.domains.includes(msg.domain)
    )
      summarizeFeed();
    return;
  }
  if (msg.type === "generated") {
    const pending = generations.get(msg.id);
    generations.delete(msg.id);
    msg.error
      ? pending?.reject(new Error(msg.error))
      : pending?.resolve(msg.names);
    return;
  }
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
      msg.matches !== undefined
        ? `Checked ${msg.cursor.toLocaleString()} names · ${msg.matches.toLocaleString()} available so far`
        : `Checking .com availability… ${pageDone} of ${activeSearch?.count}`,
    );
  else if (msg.type === "done") {
    feed.flush();
    const filtered = activeSearch?.filtered,
      page = activeSearch?.page || 1;
    paused = false;
    activeSearch = undefined;
    setBusy(false);
    runState("done");
    summarizeFeed(filtered, page);
    $("#lookup-stats").textContent =
      `Last page: ${msg.emitted} results from ${msg.cursor.toLocaleString()} candidates. RDAP ${msg.stats.rdap} · DNS ${msg.stats.dns} · ${msg.stats.skipped} RDAP checks skipped · ${msg.stats.cacheHits} cached.`;
  } else if (msg.type === "paused") {
    paused = Boolean(activeSearch);
    setBusy(false);
    runState("paused");
    status("Paused. Progress is saved.");
  } else if (msg.type === "error") {
    paused = Boolean(activeSearch);
    setBusy(false);
    runState("error");
    status(`Checking stopped: ${msg.error}`);
    list.querySelectorAll<HTMLElement>(".checking").forEach((badge) => {
      mark(badge.closest("li")!, badge, "error", "not confirmed");
    });
  }
};
lookup.onerror = () => {
  lookupFailed = true;
  for (const check of domainChecks.values()) {
    check.pending = false;
    check.error = "Checking stopped. Reload this page to try again.";
  }
  syncNameStatuses();
  paused = Boolean(activeSearch);
  setBusy(false);
  runState("error");
  status("Checking stopped. Reload to resume.");
};
$("#inspect-cache").onclick = () =>
  lookup.postMessage({ type: "stats", id: requestId });
$("#clear-cache").onclick = () => {
  cancel();
  lookup.postMessage({ type: "clear", id: requestId });
};
// Backup, import and CSV export are rare actions; they load with analysis-ui.
$("#backup").onclick = () =>
  ui().then((m) => {
    m.backup(saved, JSON.parse(storageGet(prefKey) || "{}"));
    $("#saved-status").textContent =
      "Backup download started. Keep this file outside browser storage.";
  });
input("import").onchange = () =>
  ui()
    .then((m) => m.readBackup(input("import").files?.[0]))
    .then((data) => {
      if (!data) return;
      if (!validSaved(data))
        throw new Error("This is not a valid shortlist backup");
      saved = { ...saved, ...data };
      storageSet(savedKey, JSON.stringify(saved));
      renderSaved();
      $("#saved-status").textContent =
        `Imported. ${Object.keys(saved).length} saved names.`;
    })
    .catch((error) => ($("#saved-status").textContent = error.message))
    .finally(() => (input("import").value = ""));
$("#export-results").onclick = () =>
  ui().then((m) => m.exportCsv(feed.domains, rows));
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
  else if (id === "reverse") checkList($("#panel-reverse"));
  scrollTo({ top: 0 });
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

function applySettings(
  dials: Record<string, number>,
  structure: Record<string, string | number>,
  recipe: string,
) {
  const source =
    "Similar to " +
    (activeView?.item.name || input("reverse-word").value.trim());
  (document.querySelector("dialog[open]") as HTMLDialogElement)?.close();
  switchTab("explore");
  setMood(recipe);
  for (const d of DIALS) {
    input(d).value = String(dials[d]);
    input(d).dataset.explicit = "true";
  }
  for (const key of ["length", "syllables", "opening", "ending"])
    (document.getElementById(key) as HTMLInputElement).value = String(
      structure[key],
    );
  input("page").value = "1";
  syncProfile();
  run(false, source);
}

// Name sheet: details and actions for one name.
const sheet = $<HTMLDialogElement>("#name-sheet");
interface NameView {
  item: Name;
  sound: HTMLElement;
  nearby: HTMLElement;
  scroll: number;
  focus?: HTMLElement;
  disposed?: boolean;
  cancel?: () => void;
}
let activeView: NameView | undefined, rootOpener: HTMLElement | undefined;
const nameHistory: NameView[] = [];
function disposeView(view?: NameView) {
  if (view) {
    view.disposed = true;
    view.cancel?.();
  }
}
function updateNameDetails() {
  if (!activeView) return;
  const item = activeView.item,
    domain = item.domain,
    row = domain ? rows.get(domain) : undefined,
    available = row?.status === "possibly available",
    open = $<HTMLAnchorElement>("#ns-open"),
    pill = $("#ns-status");
  const check = domain ? domainChecks.get(domain) : undefined,
    button = $("#ns-check"),
    pending = Boolean(check?.pending),
    action = pending
      ? "Checking"
      : check?.error
        ? "Retry check for"
        : row
          ? "Refresh check for"
          : "Check";
  button.hidden = !domain;
  button.setAttribute("aria-disabled", String(pending));
  button.setAttribute(
    "aria-label",
    `${action} ${domain || ".com availability"}`,
  );
  button.title = button.getAttribute("aria-label")!;
  $("#ns-name").textContent = item.name;
  $("#ns-domain").textContent = domain || "Reference name";
  pill.hidden = !domain;
  pill.dataset.status = !pending && available ? "available" : "";
  setText(
    pill,
    pending
      ? "Checking…"
      : row
        ? cap(row.status)
        : check?.error
          ? "Not confirmed"
          : "Not checked yet",
  );
  let note = !domain
    ? "This reference is not a single .com name. You can still save it and explore its sound."
    : row
      ? `${available ? "RDAP found no registration. Confirm with a registrar before you buy." : "This .com is already registered."} Checked ${new Date(row.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} from ${({ rdap: "the .com registry (RDAP)", dns: "DNS records" } as Record<string, string>)[row.source] || "a saved check"}.`
      : "Use the refresh icon beside the status to check this .com.";
  if (domain && (pending || check?.error))
    note =
      `${pending ? "Checking this .com…" : `${row ? "Refresh failed" : "Check failed"}. ${check!.error}`} ${row ? "Previous result: " + note : ""}`.trim();
  setText($("#ns-note"), note);
  open.hidden = !domain;
  if (domain)
    open.href =
      row?.status === "registered"
        ? `https://${domain}`
        : `https://lookup.icann.org/en/lookup?name=${domain}`;
  else open.removeAttribute("href");
  open.lastElementChild!.textContent =
    row?.status === "registered" ? "Visit site" : "Registry ↗";
  $("#ns-save").dataset.save = nameKey(item);
  $("#ns-save").dataset.name = item.name;
  const back = $("#ns-back");
  back.hidden = !nameHistory.length;
  back.textContent = nameHistory.length
    ? "← Back to " + nameHistory.at(-1)!.item.name
    : "Back";
  updateSavedButtons();
}
function showNameView(view: NameView, restore = false) {
  activeView = view;
  $("#ns-sound").replaceWith(view.sound);
  $("#ns-nearby").replaceWith(view.nearby);
  updateNameDetails();
  syncNameStatuses();
  if (!sheet.open) sheet.showModal();
  checkList(view.nearby);
  if (view.item.domain)
    lookup.postMessage({
      type: "cached",
      id: ++detailId,
      domain: view.item.domain,
    });
  requestAnimationFrame(() => {
    if (activeView !== view || !sheet.open) return;
    const focus =
      restore && view.focus?.isConnected ? view.focus : $("#ns-name");
    focus.focus({ preventScroll: true });
    sheet.scrollTop = restore ? view.scroll : 0;
  });
}
function openName(item: Name, opener: HTMLElement) {
  if (!item.reading && saved[nameKey(item)]?.reading)
    item = { ...item, reading: saved[nameKey(item)].reading };
  if (sheet.open && activeView) {
    if (nameKey(activeView.item) === nameKey(item)) return;
    activeView.scroll = sheet.scrollTop;
    activeView.focus = opener;
    nameHistory.push(activeView);
    if (nameHistory.length > 20) disposeView(nameHistory.shift());
  } else {
    disposeView(activeView);
    nameHistory.splice(0).forEach(disposeView);
    rootOpener = opener;
  }
  const sound = el("div"),
    nearby = el("div");
  sound.id = "ns-sound";
  nearby.id = "ns-nearby";
  sound.append(el("p", "muted", "Reading the sound…"));
  const view: NameView = { item, sound, nearby, scroll: 0 };
  showNameView(view);
  ui().then((m) => {
    if (!view.disposed)
      view.cancel = m.nameSound(
        item,
        input("seed").value,
        sound,
        nearby,
        applySettings,
        discoveryCard,
      );
  });
}
$("#ns-back").onclick = () => {
  const previous = nameHistory.pop();
  if (!previous) return;
  disposeView(activeView);
  showNameView(previous, true);
};
sheet.onclose = () => {
  if (sheet.open) return;
  disposeView(activeView);
  nameHistory.splice(0).forEach(disposeView);
  activeView = undefined;
  // Release detached analyses and restore the original row after list updates.
  $("#ns-sound").replaceChildren();
  $("#ns-nearby").replaceChildren();
  const key = rootOpener?.closest<HTMLElement>(".name-card")?.dataset.key;
  if (!$("#panel-saved").hidden) {
    renderSaved();
    rootOpener =
      [...$("#saved-list").querySelectorAll<HTMLElement>(".name-card")]
        .find((row) => row.dataset.key === key)
        ?.querySelector<HTMLElement>(".name-open") || $("#tab-saved");
  }
  if (!rootOpener?.isConnected)
    rootOpener =
      [...document.querySelectorAll<HTMLElement>(".name-card")]
        .find((row) => row.dataset.key === key && !row.closest("[hidden]"))
        ?.querySelector<HTMLElement>(".name-open") || undefined;
  const focus =
    rootOpener && !rootOpener.closest("[hidden]")
      ? rootOpener
      : document.querySelector<HTMLElement>(
          '[role="tab"][aria-selected="true"]',
        );
  // A delayed close event must not steal focus from a newly opened Tune sheet.
  if (!document.querySelector("dialog[open]"))
    focus?.focus({ preventScroll: true });
  rootOpener = undefined;
};
$("#ns-copy").onclick = () => {
  const name = activeView?.item.name;
  if (!name) return;
  navigator.clipboard.writeText(name).then(
    () => toast("Copied " + name),
    () => toast("Copy is not available here"),
  );
};
function checkDomain(domain: string | undefined, refresh = true) {
  if (!domain || domainChecks.get(domain)?.pending) return;
  const fresh = Date.now() - (refresh ? 0 : 5 * 60 * 1000);
  if (
    !refresh &&
    ((rows.get(domain)?.checkedAt || 0) >= fresh ||
      domainChecks.get(domain)?.error)
  )
    return;
  const id = ++detailId;
  if (lookupFailed) {
    domainChecks.set(domain, {
      id,
      pending: false,
      error: "Checking stopped. Reload this page to try again.",
    });
    syncNameStatuses(domain);
    return;
  }
  domainChecks.set(domain, {
    id,
    pending: navigator.onLine,
    ...(!navigator.onLine
      ? { error: "You’re offline. Reconnect, then retry." }
      : {}),
  });
  syncNameStatuses(domain);
  if (navigator.onLine)
    lookup.postMessage({
      type: "check",
      id,
      domain,
      fresh,
      options: options(),
    });
  else lookup.postMessage({ type: "cached", id, domain });
}
$("#ns-check").onclick = () => {
  checkDomain(activeView?.item.domain);
};

// Reverse: type a name, get the result; follow-ups fold in the other tools.
const reverse = $("#panel-reverse"),
  form = reverse.querySelector<HTMLFormElement>("form")!,
  line = reverse.querySelector<HTMLElement>(".tool-status")!,
  more = reverse.querySelector<HTMLElement>(".tool-more")!,
  follow = reverse.querySelector<HTMLElement>(".follow")!,
  modeSelect = form.elements.namedItem("reading-mode") as HTMLSelectElement,
  readingValue = form.elements.namedItem("reading-value") as HTMLInputElement;
readingValue.disabled = true;
modeSelect.onchange = () => {
  readingValue.disabled = modeSelect.value === "dictionary";
  readingValue.required = !readingValue.disabled;
  setText(
    reverse.querySelector<HTMLElement>(".pron .fold-value")!,
    modeSelect.selectedOptions[0].text,
  );
};
let reverseAnalysis = 0;
function analyseReverse(mode: string, source = "Reverse search") {
  const revision = ++reverseAnalysis;
  const extra = {
    seed: input("seed").value,
    ...(modeSelect.value === "reading"
      ? { reading: readingValue.value }
      : modeSelect.value === "phones"
        ? { phones: readingValue.value }
        : {}),
  };
  const word = input("reverse-word").value.trim();
  if (mode === "reverse")
    recordSearch(source, captureControls(), {
      word,
      mode: modeSelect.value as "dictionary" | "reading" | "phones",
      value: readingValue.value,
    });
  reverse.dataset.busy = "";
  line.textContent = "Reading the sound…";
  ui().then((m) =>
    m.analyse(mode, word, extra, (result, error) => {
      if (revision !== reverseAnalysis) return;
      delete reverse.dataset.busy;
      line.textContent =
        error ||
        "Analysis complete. Domain availability updates beside each name.";
      if (mode === "reverse") {
        follow.hidden = Boolean(error);
        more.replaceChildren();
        m.showReport(
          reverse.querySelector(".tool-result")!,
          result,
          error,
          applySettings,
          discoveryCard,
        );
      } else if (mode === "inverter")
        m.showFit(more, result, error, applySettings);
      else m.showNearby(more, result, error, discoveryCard);
    }),
  );
}
form.onsubmit = (event) => {
  event.preventDefault();
  if (reverse.dataset.busy === undefined && form.reportValidity())
    analyseReverse("reverse");
};
follow
  .querySelectorAll<HTMLButtonElement>("[data-follow]")
  .forEach((b) => (b.onclick = () => analyseReverse(b.dataset.follow!)));

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
addEventListener("offline", () => {
  lookup.postMessage({ type: "offline" });
  if (running) {
    resumeOnVisible = true;
    cancel();
    runState("offline");
    status("You’re offline. Checking resumes when you reconnect.");
  }
});
addEventListener("online", () => {
  const retryCurrent =
    activeView?.item.domain &&
    domainChecks.get(activeView.item.domain)?.error?.includes("offline");
  for (const [domain, check] of domainChecks)
    if (check.error?.includes("offline")) domainChecks.delete(domain);
  checkList();
  if (retryCurrent && sheet.open) checkDomain(activeView?.item.domain, false);
  syncNameStatuses();
  if (resumeOnVisible && !document.hidden && activeSearch) {
    resumeOnVisible = false;
    beginSearch(activeSearch);
  }
});
addEventListener("pagehide", () => {
  if (running) lookup.postMessage({ type: "pause" });
});
function network() {
  $("#net").dataset.online = String(navigator.onLine);
  $("#net-label").textContent = navigator.onLine ? "Online" : "Offline";
}
network();
addEventListener("online", network);
addEventListener("offline", network);

// Land on the feed: start the default (CLI-equivalent) search immediately.
try {
  syncProfile();
} catch {
  setMood("calm");
}
run(false, "Opened page");
renderSaved();
// Web fonts after the first frame (see style.css); cached visits
// already enabled them in <head>.
requestAnimationFrame(() =>
  setTimeout(() => {
    document.documentElement.classList.add("fonts");
    Promise.all(
      ["500 1em Funnel Display", "1em Inter", "600 1em Inter"].map((f) =>
        document.fonts.load(f),
      ),
    )
      .then(() => localStorage.setItem("bne.fonts.v2", "1"))
      .catch(() => {});
  }),
);
if ("serviceWorker" in navigator)
  addEventListener("load", () => {
    void navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js", {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .catch(() => {});
  });
