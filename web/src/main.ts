import { Feed } from "./feed";
import "./style.css";
import {
  MOODS,
  DIALS,
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
  saved: Record<string, { name: string; domain: string; addedAt: number }> = {},
  running = false,
  paused = false,
  requestId = 0,
  activeSearch: SearchState | undefined,
  lastSearch: SearchState | undefined,
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
      "Browser storage is unavailable. Download a shortlist backup to keep it.",
    );
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
  setText($("#mood-label"), label);
  setText($("#feed-title"), `Names that feel ${mood}`);
  setText($("#mood-summary"), label);
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
function openTune(section?: string) {
  if (section) ($(section) as HTMLDetailsElement).open = true;
  if (!tune.open) wide.matches ? tune.show() : tune.showModal();
  $("#tune-btn").setAttribute("aria-expanded", "true");
}
tune.onclose = () => {
  $("#tune-btn").setAttribute("aria-expanded", "false");
  if (dirty) run();
};
tune.onkeydown = (e) => {
  if (e.key === "Escape" && !tune.matches(":modal")) tune.close();
};
$("#tune-btn").onclick = () => (tune.open ? tune.close() : openTune());
$("#mood-chip").onclick = () => openTune("#mood-controls");
$("#generate-form").onsubmit = (event) => {
  event.preventDefault();
  dirty = false;
  tune.close();
  run();
};
document
  .querySelectorAll<HTMLElement>("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog")!.close()));
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d && d.matches(":modal")) d.close();
  }),
);

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

// Feed rows. Clicks are delegated: the heart saves, the name opens the sheet.
function updateSavedButtons(root: ParentNode = document) {
  const n = Object.keys(saved).length;
  $("#saved-count").textContent = String(n);
  $("#saved-count").dataset.n = String(n);
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
  setText($("#ns-save span"), saved[sheetDomain] ? "Saved" : "Save");
}
function nameCard(domain: string, row?: DomainRow): HTMLLIElement {
  const name = cap(domain.slice(0, -4)),
    li = el("li", "name-card") as HTMLLIElement,
    title = el("h3"),
    open = el("button", "name-open", name),
    meta = el("p", "meta"),
    badge = el("span"),
    save = el("button", "save-name") as HTMLButtonElement;
  li.dataset.domain = domain;
  open.setAttribute("type", "button");
  title.append(open);
  mark(
    li,
    badge,
    row?.status === "possibly available"
      ? "available"
      : row?.status === "registered"
        ? "registered"
        : "unchecked",
    row?.status || "not checked",
  );
  if (row)
    badge.title = `${row.source} · ${new Date(row.checkedAt).toLocaleString()}`;
  meta.append(el("span", "domain", domain), badge);
  save.type = "button";
  save.dataset.save = domain;
  save.dataset.name = name;
  li.append(title, meta, save);
  return li;
}
function mark(li: HTMLElement, badge: Element, state: string, text: string) {
  li.dataset.status = state;
  badge.className = "domain-status " + state;
  badge.textContent = text;
}
const feed = new Feed(
  list,
  (domain) => {
    const card = nameCard(domain, rows.get(domain));
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
  rows.set(row.domain, row);
  feed.update(row.domain);
  pageDone++;
  meter();
}
function toggleSave(domain: string) {
  if (saved[domain]) delete saved[domain];
  else
    saved[domain] = {
      name: cap(domain.slice(0, -4)),
      domain,
      addedAt: Date.now(),
    };
  storageSet(savedKey, JSON.stringify(saved));
  updateSavedButtons();
}
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement,
    save = target.closest<HTMLElement>("[data-save]"),
    open = target.closest(".name-open");
  if (save) {
    toggleSave(save.dataset.save!);
    save.classList.remove("pop");
    void save.offsetWidth;
    save.classList.add("pop");
    if (save.closest("#saved-list")) renderSaved();
  } else if (open) openName(open.closest("li")!.dataset.domain!);
});
function renderSaved() {
  const domains = Object.keys(saved),
    saveList = $("#saved-list");
  saveList.replaceChildren(
    ...domains.map((domain) => nameCard(domain, rows.get(domain))),
  );
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
async function run(more = false) {
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
    cancel();
    runState("running");
    const names =
      !checksOn || !navigator.onLine ? await generateNames(search) : [];
    if (token !== generationEpoch) return;
    dirty = false;
    $("#notice").hidden = true;
    activeSearch = undefined;
    lastSearch = search;
    pageStart = more ? feed.length : 0;
    if (!more)
      for (const domain of rows.keys()) if (!saved[domain]) rows.delete(domain);
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
// Infinite-scroll feel: after a real scroll gesture, reaching Load more loads it.
addEventListener("wheel", () => (userScrolled = true), { passive: true });
addEventListener("touchmove", () => (userScrolled = true), { passive: true });
new IntersectionObserver(([entry]) => {
  if (
    entry.isIntersecting &&
    userScrolled &&
    !running &&
    $("#stage").dataset.state === "done"
  )
    run(true);
}).observe($("#next"));
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
    status(
      filtered
        ? `${feed.length} possibly available .com names${onPage(page)}`
        : `${feed.length} names · ${feed.domains.filter((d) => rows.get(d)?.status === "possibly available").length} possibly available${onPage(page)}`,
    );
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
  run();
}

// Name sheet: details and actions for one name.
const sheet = $<HTMLDialogElement>("#name-sheet");
let sheetDomain = "";
function openName(domain: string) {
  const name = cap(domain.slice(0, -4)),
    row = rows.get(domain),
    available = row?.status === "possibly available",
    open = $<HTMLAnchorElement>("#ns-open"),
    pill = $("#ns-status");
  sheetDomain = domain;
  $("#ns-name").textContent = name;
  $("#ns-domain").textContent = domain;
  pill.dataset.status = available ? "available" : "";
  pill.textContent = row ? cap(row.status) : "Not checked yet";
  $("#ns-note").textContent = row
    ? `${available ? "RDAP found no registration. Confirm with a registrar before you buy." : "This .com is already registered."} Checked ${new Date(row.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} from ${({ rdap: "the .com registry (RDAP)", dns: "DNS records" } as Record<string, string>)[row.source] || "a saved check"}.`
    : "Availability has not been checked for this name yet.";
  open.href = available
    ? `https://lookup.icann.org/en/lookup?name=${domain}`
    : `https://${domain}`;
  open.lastElementChild!.textContent = available ? "Look up" : "Visit site";
  $("#ns-save").dataset.save = domain;
  $("#ns-save").dataset.name = name;
  updateSavedButtons();
  $("#ns-sound").replaceChildren(el("p", "muted", "Reading the sound…"));
  $("#ns-nearby").replaceChildren();
  sheet.showModal();
  ui().then((m) =>
    m.nameSound(
      name.toLowerCase(),
      input("seed").value,
      $("#ns-sound"),
      $("#ns-nearby"),
      applySettings,
    ),
  );
}
sheet.onclose = () => {
  if (!$("#panel-saved").hidden) renderSaved();
};
$("#ns-copy").onclick = () =>
  navigator.clipboard.writeText($("#ns-name").textContent!).then(
    () => toast("Copied " + $("#ns-name").textContent),
    () => toast("Copy is not available here"),
  );

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
function analyseReverse(mode: string) {
  const extra = {
    seed: input("seed").value,
    ...(modeSelect.value === "reading"
      ? { reading: readingValue.value }
      : modeSelect.value === "phones"
        ? { phones: readingValue.value }
        : {}),
  };
  reverse.dataset.busy = "";
  line.textContent = "Reading the sound…";
  ui().then((m) =>
    m.analyse(
      mode,
      input("reverse-word").value.trim(),
      extra,
      (result, error) => {
        delete reverse.dataset.busy;
        line.textContent =
          error || "Analysis complete. No domain lookups were made.";
        if (mode === "reverse") {
          follow.hidden = Boolean(error);
          more.replaceChildren();
          m.showReport(
            reverse.querySelector(".tool-result")!,
            result,
            error,
            applySettings,
          );
        } else if (mode === "inverter")
          m.showFit(more, result, error, applySettings);
        else m.showNearby(more, result, error);
      },
    ),
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
  if (running) {
    resumeOnVisible = true;
    cancel();
    runState("offline");
    status("You’re offline. Checking resumes when you reconnect.");
  }
});
addEventListener("online", () => {
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
run();
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
    ).then(
      () => localStorage.setItem("bne.fonts.v2", "1"),
      () => {},
    );
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
