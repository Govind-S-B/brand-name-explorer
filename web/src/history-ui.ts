import type { Controls, HistoryEntry } from "./history";
const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
function summary(c: Controls) {
  return `${cap(String(c.mood))}${c.blend ? " + " + cap(String(c.blend)) : ""} · ${c.length} letters · seed ${c.seed}`;
}
export function updateTimes(root: HTMLElement) {
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  root.querySelectorAll<HTMLTimeElement>("time").forEach((time) => {
    const seconds = Math.max(
      0,
      (Date.now() - Date.parse(time.dateTime)) / 1000,
    );
    const [size, unit] =
      seconds < 3600
        ? [60, "minute"]
        : seconds < 86400
          ? [3600, "hour"]
          : [86400, "day"];
    time.textContent =
      seconds < 60
        ? "Just now"
        : relative.format(
            -Math.floor(seconds / Number(size)),
            unit as Intl.RelativeTimeFormatUnit,
          );
  });
}
export function renderHistory(
  root: HTMLElement,
  entries: HistoryEntry[],
  query: string,
  runAgain: (entry: HistoryEntry) => void,
) {
  const matching = entries.filter((entry) =>
    JSON.stringify(entry).toLowerCase().includes(query.trim().toLowerCase()),
  );
  root.replaceChildren();
  if (!matching.length) {
    root.append(
      el(
        "li",
        "empty-history",
        query
          ? "No matching searches."
          : "Your searches will appear here. History stays in this browser.",
      ),
    );
    return;
  }
  for (const entry of matching) {
    const row = el("li", "history-entry"),
      details = el("details"),
      head = el("summary"),
      title = el(
        "span",
        "history-title",
        entry.reverse ? `Reverse · ${entry.reverse.word}` : entry.source,
      ),
      time = document.createElement("time"),
      description = el("span", "history-description", summary(entry.controls));
    time.dateTime = new Date(entry.at).toISOString();
    time.title = new Date(entry.at).toLocaleString();
    head.append(title, time, description);
    details.append(head);
    details.addEventListener("toggle", () => {
      if (!details.hasAttribute("open") || details.childElementCount > 1) return;
      const c = entry.controls,
        info = el("dl", "history-params");
      const fields: [string, string][] = [
        ["Searched", new Date(entry.at).toLocaleString()],
        ["Seed", String(c.seed)],
        ["Mood", String(c.mood)],
        [
          "Blend",
          c.blend
            ? `${c.blend} · ${Math.round(Number(c["blend-amount"]) * 100)}%`
            : "None",
        ],
        [
          "Dials",
          `Energy ${c.energy} · weight ${c.weight} · novelty ${c.novelty}`,
        ],
        ["Custom dials", String(c.explicit || "From mood")],
        [
          "Structure",
          `${c.length} letters · ${c.syllables || "auto"} syllables · ${c.opening} opening · ${c.ending || "from mood"} ending`,
        ],
        ["Page", `${c.page} · ${c.count} names per page`],
        [
          "Domains",
          `${c["check-domains"] ? "Checks on" : "Checks off"} · ${c["filter-available"] ? "available only" : "all names"} · DNS ${c["use-dns"] ? "on" : "off"}${entry.fresh ? " · fresh lookups" : ""}`,
        ],
        [
          "Lookup tuning",
          `${c["rdap-concurrency"]} RDAP connections · ${c["rdap-rate"]}/sec; ${c["dns-concurrency"]} DNS slots · ${c["dns-rate"]}/sec; ${c["dns-timeout"]} ms DNS timeout · ${c["hedge-delay"]} ms fallback`,
        ],
      ];
      if (entry.reverse)
        fields.push([
          "Reading",
          entry.reverse.mode === "dictionary"
            ? "Dictionary, then spelling"
            : `${entry.reverse.mode}: ${entry.reverse.value}`,
        ]);
      for (const [key, value] of fields)
        info.append(el("dt", "", key), el("dd", "", value));
      const button = el("button", "pill-btn", "Run again →");
      button.onclick = () => runAgain(entry);
      details.append(info, button);
    });
    row.append(details);
    root.append(row);
  }
  updateTimes(root);
}
