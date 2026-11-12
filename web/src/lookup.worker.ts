import { generate } from "../../core/generator";
import { LookupEngine, type LookupOptions } from "../../lookup/engine";
import { CacheStore } from "./lookup/store";
import { searchNames, type Search } from "../../lookup/search";
let current: LookupEngine | undefined;
let tail = Promise.resolve();
let epoch = 0;
const checks = new Map<
  string,
  {
    id: number;
    fresh: number;
    options?: Partial<LookupOptions>;
    task?: Promise<void>;
  }
>();
let checksQueued = false;

async function locked(work: () => Promise<void>) {
  if (!navigator.locks) return work();
  await navigator.locks.request(
    "bne-domain-search",
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "Another explorer tab is checking domains. Pause it before trying again here.",
        );
      await work();
    },
  );
}
function startChecks() {
  if (!current || current.stopped) return;
  for (const [domain, check] of checks) {
    if (check.task) continue;
    check.task = current
      .get(domain, check.fresh, true)
      .then(
        (row) => {
          checks.delete(domain);
          self.postMessage({ type: "checked", id: check.id, domain, row });
        },
        (error) => {
          // A feed change may replace the engine. Retry the explicit check there.
          if (error.name === "AbortError") return;
          checks.delete(domain);
          self.postMessage({
            type: "checked",
            id: check.id,
            domain,
            error: error.message,
          });
        },
      )
      .finally(() => {
        check.task = undefined;
      });
  }
}
async function finishChecks(engine: LookupEngine) {
  while (checks.size && !engine.stopped) {
    startChecks();
    await Promise.all([...checks.values()].map((check) => check.task));
  }
}
function queueChecks() {
  if (checksQueued || !checks.size) return;
  checksQueued = true;
  tail = tail
    .then(async () => {
      checksQueued = false;
      if (!checks.size) return;
      await locked(async () => {
        const store = await CacheStore.open();
        let engine: LookupEngine | undefined;
        try {
          engine = current = new LookupEngine(
            store,
            checks.values().next().value?.options,
          );
          await finishChecks(engine);
        } finally {
          await engine?.close();
          current = undefined;
          store.close();
        }
      });
    })
    .catch((error) => {
      for (const [domain, check] of checks)
        self.postMessage({
          type: "checked",
          id: check.id,
          domain,
          error: error.message,
        });
      checks.clear();
    })
    .finally(queueChecks);
}
async function cached(id: number, domain: string) {
  let store: CacheStore | undefined;
  try {
    store = await CacheStore.open();
    const row = await store.getDomain(domain);
    self.postMessage({ type: "cached", id, domain, row });
  } catch {
    // A cache miss/failure is not an availability result; explicit checks report errors.
  } finally {
    store?.close();
  }
}
self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === "offline") {
    epoch++;
    for (const [domain, check] of checks)
      self.postMessage({
        type: "checked",
        id: check.id,
        domain,
        error: "You’re offline. Reconnect, then retry.",
      });
    checks.clear();
    void current?.close();
    return;
  }
  if (msg.type === "cached") {
    void cached(msg.id, msg.domain);
    return;
  }
  if (msg.type === "check") {
    if (!checks.has(msg.domain))
      checks.set(msg.domain, {
        id: msg.id,
        fresh: Date.now(),
        options: msg.options,
      });
    startChecks();
    if (!current || current.stopped) queueChecks();
    return;
  }
  if (msg.type === "generate") {
    try {
      self.postMessage({
        type: "generated",
        id: msg.id,
        names: generate(msg.settings, msg.count, msg.page),
      });
    } catch (error) {
      self.postMessage({
        type: "generated",
        id: msg.id,
        error: (error as Error).message,
      });
    }
    return;
  }
  if (msg.type === "pause") {
    epoch++;
    void current?.close();
    return;
  }
  if (msg.type === "search") {
    msg.epoch = ++epoch;
    void current?.close();
  }
  tail = tail
    .then(async () => {
      if (msg.type === "search") {
        if (msg.epoch !== epoch) return;
        await locked(() => search(msg));
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
    )
    .finally(queueChecks);
};
async function search(
  msg: Search & { id: number; epoch: number; options?: Partial<LookupOptions> },
) {
  let store: CacheStore | undefined, engine: LookupEngine | undefined;
  try {
    if (msg.count > 4000) throw new Error("Choose 1–4,000 names per page");
    store = await CacheStore.open();
    if (msg.epoch !== epoch) throw new DOMException("Paused", "AbortError");
    engine = new LookupEngine(store, msg.options);
    current = engine;
    startChecks();
    await searchNames(msg, store, engine, (type, data) =>
      self.postMessage({ id: msg.id, type, ...data, stats: engine!.stats }),
    );
    engine.cancelBackground();
    await finishChecks(engine);
  } catch (error) {
    self.postMessage({
      id: msg.id,
      type: (error as Error).name === "AbortError" ? "paused" : "error",
      error: (error as Error).message,
      stats: engine?.stats,
    });
  } finally {
    await engine?.close();
    current = undefined;
    store?.close();
  }
}
