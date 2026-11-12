import type { DomainRow } from "../../lookup/store";

export interface Reading {
  phones: string[];
  source: string;
  boundaries?: number[];
}
export interface Name {
  name: string;
  domain?: string;
  reading?: Reading;
}
export type SavedName = Name & { addedAt: number };
const entries = new WeakMap<HTMLElement, Name>();
export const nameKey = (item: Name) =>
  item.domain || "name:" + item.name.toLowerCase();
export function nameFrom(label: string, reading?: Reading): Name {
  const name = label.trim(),
    lower = name.toLowerCase();
  if (!name || name.length > 80 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name))
    throw new Error("Invalid name");
  return {
    name: /^[a-z]/.test(name) ? name[0].toUpperCase() + name.slice(1) : name,
    ...(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(lower)
      ? { domain: lower + ".com" }
      : {}),
    ...(reading ? { reading } : {}),
  };
}
export function rowName(element: Element): Name | undefined {
  const row = element.closest<HTMLElement>(".name-card");
  return row ? entries.get(row) : undefined;
}
export function validSaved(value: unknown): value is Record<string, SavedName> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length <= 10000 &&
    Object.entries(value).every(([key, v]) => {
      if (
        !v ||
        typeof v !== "object" ||
        typeof v.name !== "string" ||
        !v.name.trim() ||
        v.name.length > 80 ||
        /[\p{C}\p{Zl}\p{Zp}]/u.test(v.name) ||
        !Number.isFinite(v.addedAt)
      )
        return false;
      const item = nameFrom(v.name);
      return (
        key === nameKey(item) &&
        v.domain === item.domain &&
        (!v.reading ||
          (typeof v.reading.source === "string" &&
            v.reading.source.length <= 160 &&
            Array.isArray(v.reading.phones) &&
            v.reading.phones.length > 0 &&
            v.reading.phones.length <= 120 &&
            v.reading.phones.every(
              (p: unknown) =>
                typeof p === "string" && /^[A-Z]{1,3}[012]?$/.test(p),
            ) &&
            (!v.reading.boundaries ||
              (Array.isArray(v.reading.boundaries) &&
                v.reading.boundaries.length < v.reading.phones.length &&
                v.reading.boundaries.every(
                  (b: unknown) =>
                    Number.isInteger(b) &&
                    Number(b) > 0 &&
                    Number(b) < v.reading.phones.length,
                )))))
      );
    }),
  );
}
export function mark(
  li: HTMLElement,
  badge: Element,
  state: string,
  text: string,
) {
  li.dataset.status = state;
  badge.className = "domain-status " + state;
  badge.textContent = text;
}
export function updateNameStatus(li: HTMLElement, row?: DomainRow) {
  const badge = li.querySelector<HTMLElement>(".domain-status")!;
  mark(
    li,
    badge,
    row?.status === "possibly available"
      ? "available"
      : row
        ? "registered"
        : "unchecked",
    row?.status || "not checked",
  );
  badge.title = row
    ? `${row.source} · ${new Date(row.checkedAt).toLocaleString()}`
    : "";
}
export function renderName(
  item: Name,
  row: DomainRow | undefined,
  saved: boolean,
): HTMLLIElement {
  const li = document.createElement("li"),
    title = document.createElement("h3"),
    open = document.createElement("button"),
    meta = document.createElement("p"),
    domain = document.createElement("span"),
    badge = document.createElement("span"),
    save = document.createElement("button");
  entries.set(li, item);
  li.className = "name-card";
  li.dataset.key = nameKey(item);
  if (item.domain) li.dataset.domain = item.domain;
  open.type = "button";
  open.className = "name-open";
  open.textContent = item.name;
  open.setAttribute("aria-haspopup", "dialog");
  open.setAttribute("aria-controls", "name-sheet");
  title.append(open);
  meta.className = "meta";
  if (item.domain) {
    domain.className = "domain";
    domain.textContent = item.domain;
    badge.className = "domain-status";
    meta.append(domain, badge);
  } else meta.textContent = "Reference name · no .com address";
  save.type = "button";
  save.className = "save-name";
  save.dataset.save = nameKey(item);
  save.dataset.name = item.name;
  save.setAttribute("aria-pressed", String(saved));
  save.setAttribute(
    "aria-label",
    `${saved ? "Remove" : "Save"} ${item.name}${saved ? " from shortlist" : " to shortlist"}`,
  );
  li.append(title, meta, save);
  if (item.domain) updateNameStatus(li, row);
  return li;
}
