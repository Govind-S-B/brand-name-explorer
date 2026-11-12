import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings } from "../core/generator";
import type { DomainRow, DnsRow, Session, SearchStore } from "../lookup/store";
/** One SQLite transaction commits each published result or ordered checkpoint. */
export class NodeStore implements SearchStore {
  private db: DatabaseSync;
  private lock?: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    if (path !== ":memory:") {
      this.lock = new DatabaseSync(path + ".lock");
      try {
        this.lock.exec("BEGIN EXCLUSIVE");
      } catch {
        this.lock.close();
        throw new Error(
          "Another CLI is using this cache; wait or select a different --cache path",
        );
      }
    }
    try {
      this.db = new DatabaseSync(path);
    } catch (e) {
      this.lock?.close();
      throw e;
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS domains (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dns (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS matches (session TEXT, position INTEGER, value TEXT NOT NULL, PRIMARY KEY(session,position));`);
  }
  private read<T>(table: string, id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT value FROM ${table} WHERE id=?`)
      .get(id);
    return row ? JSON.parse(row.value as string) : undefined;
  }
  private put(table: string, id: string, value: unknown) {
    this.db
      .prepare(`INSERT OR REPLACE INTO ${table} VALUES (?,?)`)
      .run(id, JSON.stringify(value));
  }
  private transaction(fn: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async getDomain(id: string) {
    return this.read<DomainRow>("domains", id);
  }
  async getDns(id: string) {
    return this.read<DnsRow>("dns", id);
  }
  async saveDomain(row: DomainRow) {
    this.put("domains", row.domain, row);
  }
  async saveDns(row: DnsRow, domain?: DomainRow) {
    this.transaction(() => {
      this.put("dns", row.domain, row);
      if (domain) this.put("domains", domain.domain, domain);
    });
  }
  async getCooldown(id: string) {
    return Number(
      this.db.prepare("SELECT value FROM metadata WHERE id=?").get(id)?.value ||
        0,
    );
  }
  async setCooldown(id: string, until: number) {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=MAX(value,excluded.value)",
      )
      .run(id, until);
  }
  async startSession(
    id: string,
    settings: Settings,
    refresh = false,
  ): Promise<Session> {
    const saved = this.read<Session>("sessions", id);
    if (saved && !refresh) return saved;
    const session = {
      id,
      settings,
      cursor: 0,
      matched: 0,
      freshSince: refresh ? Date.now() : 0,
      createdAt: Date.now(),
    };
    this.transaction(() => {
      this.put("sessions", id, session);
      this.db.prepare("DELETE FROM matches WHERE session=?").run(id);
    });
    return session;
  }
  async commitSession(session: Session, rows: DomainRow[]) {
    this.transaction(() => {
      this.put("sessions", session.id, session);
      const put = this.db.prepare(
        "INSERT OR REPLACE INTO matches VALUES (?,?,?)",
      );
      rows.forEach((r, i) =>
        put.run(
          session.id,
          session.matched - rows.length + i,
          JSON.stringify(r),
        ),
      );
    });
  }
  async getMatches(
    id: string,
    start: number,
    stop: number,
  ): Promise<DomainRow[]> {
    return this.db
      .prepare(
        "SELECT value FROM matches WHERE session=? AND position>=? AND position<? ORDER BY position",
      )
      .all(id, start, stop)
      .map((r) => ({ ...JSON.parse(r.value as string), source: "saved" }));
  }
  stats() {
    return Object.fromEntries(
      ["domains", "dns", "sessions", "matches"].map((t) => [
        t,
        this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n,
      ]),
    );
  }
  clearCache() {
    this.transaction(() => {
      for (const t of ["domains", "dns", "metadata"])
        this.db.exec(`DELETE FROM ${t}`);
    });
  }
  close() {
    this.db.close();
    this.lock?.close();
  }
}
