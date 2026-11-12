import { createSpace, type Settings } from "./core/generator";
import { LookupEngine, type LookupOptions } from "./lookup/engine";
import { CacheStore, sessionId, type DomainRow } from "./lookup/store";
let current: { id: number; engine: LookupEngine } | undefined;
let tail = Promise.resolve();
let epoch = 0;
self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === "pause") {
    epoch++;
    void current?.engine.close();
    return;
  }
  if (msg.type === "search") {
    msg.epoch = ++epoch;
    void current?.engine.close();
  }
  tail = tail
    .then(async () => {
      if (msg.type === "search") {
        if (msg.epoch !== epoch) return;
        if (current) await current.engine.close();
        if (navigator.locks) {
          await navigator.locks.request(
            "bne-domain-search",
            { ifAvailable: true },
            async (lock) => {
              if (!lock)
                throw new Error(
                  "Another explorer tab is checking domains. Pause it before resuming here.",
                );
              await search(msg);
            },
          );
        } else await search(msg);
      } else if (msg.type === "stats" || msg.type === "clear") {
        const store = await CacheStore.open();
        try {
          if (msg.type === "clear") await store.clearCache();
          self.postMessage({
            id: msg.id,
            type: "cache",
            stats: await store.stats(),
          });
        } finally {
          store.close();
        }
      }
    })
    .catch((error) =>
      self.postMessage({
        id: msg.id,
        type: "error",
        error: (error as Error).message,
      }),
    );
};
interface Search {
  epoch: number;
  id: number;
  settings: Settings;
  count: number;
  page: number;
  filtered: boolean;
  refresh: boolean;
  options?: Partial<LookupOptions>;
}
async function search(msg: Search) {
  let store: CacheStore | undefined, engine: LookupEngine | undefined;
  let emitted = 0;
  const fresh = msg.refresh ? Date.now() : 0;
  try {
    if (
      !Number.isInteger(msg.count) ||
      msg.count < 1 ||
      msg.count > 4000 ||
      !Number.isInteger(msg.page) ||
      msg.page < 1
    )
      throw new Error(
        "Choose 1–4,000 names per page and a positive page number",
      );
    const space = createSpace(msg.settings),
      start = (msg.page - 1) * msg.count,
      stop = msg.page * msg.count;
    if (start >= space.capacity)
      throw new Error("Page is outside this name space");
    store = await CacheStore.open();
    if (msg.epoch !== epoch) throw new DOMException("Paused", "AbortError");
    engine = new LookupEngine(store, msg.options);
    current = { id: msg.id, engine };
    const key = await sessionId(msg.settings),
      session = msg.filtered
        ? await store.startSession(key, msg.settings, msg.refresh)
        : undefined;
    const post = (type: string, data: Record<string, unknown> = {}) =>
      self.postMessage({ id: msg.id, type, ...data, stats: engine!.stats });
    if (session) {
      const saved = await store.getMatches(key, start, stop);
      saved.forEach((row) => {
        post("row", { row });
        emitted++;
      });
      if (session.matched >= stop) {
        post("done", {
          cursor: session.cursor,
          matches: session.matched,
          capacity: space.capacity,
          emitted,
        });
        return;
      }
    }
    const names = space.names();
    const cursor = session?.cursor ?? start;
    for (let i = 0; i < cursor; i++) {
      if (i % 256 === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (current?.id !== msg.id || engine !== current.engine)
          throw new DOMException("Paused", "AbortError");
      }
      names.next();
    }
    let index = cursor,
      exhausted = false;
    const pending: { index: number; promise: Promise<DomainRow> }[] = [];
    const completed = new Map<number, DomainRow>(),
      failures = new Map<number, unknown>();
    const checkpoint: DomainRow[] = [];
    let lastPost = 0;
    try {
      while (true) {
        const potential = pending.reduce(
          (n, item) =>
            n +
            Number(
              !completed.has(item.index) ||
                completed.get(item.index)!.status === "possibly available",
            ),
          0,
        );
        const budget = msg.filtered
          ? Math.max(0, stop - session!.matched - potential)
          : stop - index;
        const take = Math.min(256 - pending.length, budget);
        for (let n = 0; n < take && !exhausted; n++) {
          const next = names.next();
          if (next.done) {
            exhausted = true;
            break;
          }
          const position = index++;
          const domain = next.value.toLowerCase() + ".com";
          const promise = engine.get(domain, session?.freshSince ?? fresh);
          promise.then(
            (row) => completed.set(position, row),
            (error) => failures.set(position, error),
          );
          pending.push({ index: position, promise });
        }
        if (!pending.length) break;
        // Consume the committed prefix in seed order. A separate completion signal
        // lets registered rows release speculative capacity behind a slow earlier name.
        if (
          !completed.has(pending[0].index) &&
          !failures.has(pending[0].index)
        ) {
          const waiting = pending.filter(
            (p) => !completed.has(p.index) && !failures.has(p.index),
          );
          await Promise.race(
            waiting.map((p) =>
              p.promise.then(
                () => {},
                () => {},
              ),
            ),
          );
          continue;
        }
        const next = pending.shift()!,
          row = await next.promise;
        completed.delete(next.index);
        failures.delete(next.index);
        if (session) {
          session.cursor = next.index + 1;
          if (row.status === "possibly available") {
            session.matched++;
            checkpoint.push(row);
          }
          if (checkpoint.length || session.cursor % 64 === 0) {
            await store.commitSession(session, checkpoint);
            checkpoint.length = 0;
          }
          if (row.status === "possibly available" && session.matched > start) {
            post("row", { row });
            emitted++;
          }
          if (session.matched >= stop) break;
        } else {
          post("row", { row });
          emitted++;
          if (emitted >= msg.count) break;
        }
        if (Date.now() - lastPost > 500) {
          post("progress", {
            cursor: session?.cursor ?? next.index + 1,
            matches: session?.matched,
            capacity: space.capacity,
          });
          lastPost = Date.now();
        }
      }
    } finally {
      if (session) await store.commitSession(session, checkpoint);
    }
    post("done", {
      cursor: session?.cursor ?? index,
      matches: session?.matched,
      capacity: space.capacity,
      emitted,
    });
  } catch (error) {
    self.postMessage({
      id: msg.id,
      type: (error as Error).name === "AbortError" ? "paused" : "error",
      error: (error as Error).message,
      stats: engine?.stats,
      emitted,
    });
  } finally {
    await engine?.close();
    if (current?.id === msg.id) current = undefined;
    store?.close();
  }
}
