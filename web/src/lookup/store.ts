import type { Settings } from "../../../core/generator";
import type {
  DomainRow,
  DnsRow,
  Session,
  Match,
  SearchStore,
} from "../../../lookup/store";
export class CacheStore implements SearchStore {
  constructor(private db: IDBDatabase) {}
  static async open() {
    return new Promise<CacheStore>((resolve, reject) => {
      const request = indexedDB.open("brand-name-explorer", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("domains", { keyPath: "domain" });
        db.createObjectStore("dns", { keyPath: "domain" });
        db.createObjectStore("metadata", { keyPath: "key" });
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("matches", { keyPath: ["session", "index"] });
      };
      request.onerror = () =>
        reject(
          new Error(
            "Local storage could not open. Check browser storage permissions.",
          ),
        );
      request.onblocked = () =>
        reject(
          new Error("Close another explorer tab to upgrade local storage."),
        );
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(new CacheStore(request.result));
      };
    });
  }
  private async read<T>(
    store: string,
    key: IDBValidKey,
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(store, "readonly"),
        r = transaction.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  }
  private async write(
    stores: string[],
    mutate: (transaction: IDBTransaction) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(stores, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error || new Error("Local save failed"));
      transaction.onerror = () => reject(transaction.error);
      try {
        mutate(transaction);
      } catch (e) {
        transaction.abort();
        reject(e);
      }
    });
  }
  getDomain(domain: string) {
    return this.read<DomainRow>("domains", domain);
  }
  getDns(domain: string) {
    return this.read<DnsRow>("dns", domain);
  }
  saveDomain(row: DomainRow) {
    return this.write(["domains"], (t) => {
      t.objectStore("domains").put(row);
    });
  }
  saveDns(row: DnsRow, domain?: DomainRow) {
    return this.write(domain ? ["dns", "domains"] : ["dns"], (t) => {
      t.objectStore("dns").put(row);
      if (domain) t.objectStore("domains").put(domain);
    });
  }
  async getCooldown(provider: string) {
    return (
      (await this.read<{ key: string; until: number }>("metadata", provider))
        ?.until || 0
    );
  }
  async setCooldown(provider: string, until: number) {
    const previous = await this.getCooldown(provider);
    return this.write(["metadata"], (t) => {
      t.objectStore("metadata").put({
        key: provider,
        until: Math.max(previous, until),
      });
    });
  }
  getSession(id: string) {
    return this.read<Session>("sessions", id);
  }
  async startSession(
    id: string,
    settings: Settings,
    refresh = false,
  ): Promise<Session> {
    const saved = await this.getSession(id);
    if (saved && !refresh) return saved;
    const session = {
      id,
      settings,
      cursor: 0,
      matched: 0,
      freshSince: refresh ? Date.now() : 0,
      createdAt: Date.now(),
    };
    await this.write(["sessions", "matches"], (t) => {
      t.objectStore("sessions").put(session);
      t.objectStore("matches").delete(
        IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
      );
    });
    return session;
  }
  async commitSession(session: Session, rows: DomainRow[]): Promise<void> {
    const first = session.matched - rows.length;
    await this.write(["sessions", "matches"], (t) => {
      t.objectStore("sessions").put(session);
      rows.forEach((row, i) =>
        t
          .objectStore("matches")
          .put({ session: session.id, index: first + i, row }),
      );
    });
  }
  async getMatches(
    id: string,
    start: number,
    stop: number,
  ): Promise<DomainRow[]> {
    if (stop <= start) return [];
    return new Promise((resolve, reject) => {
      const r = this.db
        .transaction("matches", "readonly")
        .objectStore("matches")
        .getAll(IDBKeyRange.bound([id, start], [id, stop], false, true));
      r.onsuccess = () =>
        resolve(
          (r.result as Match[]).map((m) => ({ ...m.row, source: "saved" })),
        );
      r.onerror = () => reject(r.error);
    });
  }
  async stats() {
    const counts = await Promise.all(
      ["domains", "dns", "sessions", "matches"].map(
        (store) =>
          new Promise<number>((resolve, reject) => {
            const r = this.db.transaction(store).objectStore(store).count();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    return Object.fromEntries(
      ["domains", "dns", "sessions", "matches"].map((s, i) => [s, counts[i]]),
    );
  }
  clearCache() {
    return this.write(["domains", "dns", "metadata"], (t) => {
      for (const store of ["domains", "dns", "metadata"])
        t.objectStore(store).clear();
    });
  }
  close() {
    this.db.close();
  }
}
