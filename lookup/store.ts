import { ENGINE_ID, type Settings } from "../core/generator";
export type Status = "registered" | "possibly available";
export interface DomainRow {
  domain: string;
  status: Status;
  checkedAt: number;
  source: "dns" | "rdap" | "cache" | "saved";
}
export interface DnsRow {
  domain: string;
  outcome: "ns" | "nxdomain" | "no_ns";
  checkedAt: number;
  expiresAt: number;
  provider: string;
}
export interface Session {
  id: string;
  settings: Settings;
  cursor: number;
  matched: number;
  freshSince: number;
  createdAt: number;
}
export interface Match {
  session: string;
  index: number;
  row: DomainRow;
}
export interface LookupStore {
  getDomain(domain: string): Promise<DomainRow | undefined>;
  getDns(domain: string): Promise<DnsRow | undefined>;
  saveDomain(row: DomainRow): Promise<void>;
  saveDns(row: DnsRow, domain?: DomainRow): Promise<void>;
  getCooldown(provider: string): Promise<number>;
  setCooldown(provider: string, until: number): Promise<void>;
}
export interface SearchStore extends LookupStore {
  startSession(
    id: string,
    settings: Settings,
    refresh?: boolean,
  ): Promise<Session>;
  commitSession(session: Session, rows: DomainRow[]): Promise<void>;
  getMatches(id: string, start: number, stop: number): Promise<DomainRow[]>;
}
export async function sessionId(settings: Settings) {
  const sort = (value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, sort(v)]),
        )
      : value;
  const data = new TextEncoder().encode(
    JSON.stringify(sort({ version: ENGINE_ID, ...settings })),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
