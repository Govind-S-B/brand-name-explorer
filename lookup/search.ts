import { MoodSpace, type Settings } from "../core/generator";
import { sessionId, type SearchStore, type DomainRow } from "./store";
import type { LookupEngine } from "./engine";
export interface Search {
  settings: Settings;
  count: number;
  page: number;
  filtered: boolean;
  refresh: boolean;
}
export async function searchNames(
  msg: Search,
  store: SearchStore,
  engine: LookupEngine,
  post: (type: string, data: Record<string, any>) => void,
  signal?: AbortSignal,
) {
  let emitted = 0;
  const fresh = msg.refresh ? Date.now() : 0;
  if (
    !Number.isSafeInteger(msg.count) ||
    msg.count < 1 ||
    !Number.isSafeInteger(msg.page) ||
    msg.page < 1 ||
    !Number.isSafeInteger(msg.page * msg.count)
  )
    throw new Error("Choose a positive count and page number");
  const space = new MoodSpace(msg.settings),
    start = (msg.page - 1) * msg.count,
    stop = msg.page * msg.count;
  if (start >= space.capacity)
    throw new Error("Page is outside this name space");
  const key = await sessionId(msg.settings),
    session = msg.filtered
      ? await store.startSession(key, msg.settings, msg.refresh)
      : undefined;
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
      if (signal?.aborted || engine.stopped)
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
  let wake = () => {};
  let lastPost = 0;
  try {
    while (true) {
      if (signal?.aborted || engine.stopped)
        throw new DOMException("Paused", "AbortError");
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
          (row) => {
            completed.set(position, row);
            wake();
          },
          (error) => {
            failures.set(position, error);
            wake();
          },
        );
        pending.push({ index: position, promise });
      }
      if (!pending.length) break;
      // Consume the committed prefix in seed order. A separate completion signal
      // lets registered rows release speculative capacity behind a slow earlier name.
      if (!completed.has(pending[0].index) && !failures.has(pending[0].index)) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = () => {};
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
}
