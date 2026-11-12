import { generate } from "../../core/generator";
import { LookupEngine, type LookupOptions } from "../../lookup/engine";
import { CacheStore } from "./lookup/store";
import { searchNames, type Search } from "../../lookup/search";
let current: { id: number; engine: LookupEngine } | undefined;
let tail = Promise.resolve();
let epoch = 0;
self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
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
async function search(
  msg: Search & { id: number; epoch: number; options?: Partial<LookupOptions> },
) {
  let store: CacheStore | undefined, engine: LookupEngine | undefined;
  try {
    if (msg.count > 4000) throw new Error("Choose 1–4,000 names per page");
    store = await CacheStore.open();
    if (msg.epoch !== epoch) throw new DOMException("Paused", "AbortError");
    engine = new LookupEngine(store, msg.options);
    current = { id: msg.id, engine };
    await searchNames(msg, store, engine, (type, data) =>
      self.postMessage({ id: msg.id, type, ...data, stats: engine!.stats }),
    );
  } catch (error) {
    self.postMessage({
      id: msg.id,
      type: (error as Error).name === "AbortError" ? "paused" : "error",
      error: (error as Error).message,
      stats: engine?.stats,
    });
  } finally {
    await engine?.close();
    if (current?.id === msg.id) current = undefined;
    store?.close();
  }
}
