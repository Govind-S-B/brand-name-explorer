import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeStore } from "../cli/store";
import { LookupEngine } from "../lookup/engine";
import { searchNames } from "../lookup/search";
import { generate } from "../core/generator";
import type { Providers } from "../lookup/providers";
import type { DomainRow } from "../lookup/store";
const providers: Providers = {
  rdap: async (d) => ({
    status: d.charCodeAt(0) % 2 ? "registered" : "possibly available",
  }),
  dns: async () => ({ outcome: "nxdomain", ttl: 60 }),
};
const engine = (store: NodeStore, p = providers) => {
  const e = new LookupEngine(store, { dns: false }, p, "node");
  e.rdap.rate = 100000;
  return e;
};
test("Node SQLite resumes ordered filtered pages, page size independence, refresh and cache clearing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bne-")),
    path = join(dir, "cache.sqlite");
  const expected = generate({}, 1000)
    .map((n) => n.toLowerCase() + ".com")
    .filter((d) => d.charCodeAt(0) % 2 === 0);
  let store = new NodeStore(path),
    e = engine(store),
    rows: DomainRow[] = [];
  const post = (type: string, data: Record<string, any>) => {
    if (type === "row") rows.push(data.row);
  };
  try {
    await searchNames(
      { settings: {}, count: 20, page: 2, filtered: true, refresh: false },
      store,
      e,
      post,
    );
    assert.deepEqual(
      rows.map((r) => r.domain),
      expected.slice(20, 40),
    );
    assert.ok(rows.every((r) => r.source === "rdap"));
    await e.close();
    store.close();
    store = new NodeStore(path);
    e = engine(store, {
      ...providers,
      rdap: async () => {
        throw new Error("Must use saved page");
      },
    });
    rows = [];
    await searchNames(
      { settings: {}, count: 10, page: 3, filtered: true, refresh: false },
      store,
      e,
      post,
    );
    assert.deepEqual(
      rows.map((r) => r.domain),
      expected.slice(20, 30),
    );
    assert.equal(e.stats.rdap, 0);
    await e.close();
    store.clearCache();
    e = engine(store);
    rows = [];
    await searchNames(
      { settings: {}, count: 10, page: 3, filtered: true, refresh: false },
      store,
      e,
      post,
    );
    assert.equal(e.stats.rdap, 0);
    await e.close();
    e = engine(store);
    rows = [];
    await searchNames(
      { settings: {}, count: 10, page: 1, filtered: true, refresh: true },
      store,
      e,
      post,
    );
    assert.ok(e.stats.rdap > 0);
    assert.deepEqual(
      rows.map((r) => r.domain),
      expected.slice(0, 10),
    );
  } finally {
    await e.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Interrupted search commits only resolved prefix and resumes without losing or duplicating matches", async () => {
  const store = new NodeStore(":memory:");
  let e = engine(store);
  const rows: string[] = [];
  try {
    await assert.rejects(
      searchNames(
        { settings: {}, count: 40, page: 1, filtered: true, refresh: false },
        store,
        e,
        (type, d) => {
          if (type === "row") {
            rows.push(d.row.domain);
            if (rows.length === 5) void e.close();
          }
        },
      ),
    );
    await e.close();
    e = engine(store);
    const resumed: string[] = [];
    await searchNames(
      { settings: {}, count: 40, page: 1, filtered: true, refresh: false },
      store,
      e,
      (t, d) => {
        if (t === "row") resumed.push(d.row.domain);
      },
    );
    assert.equal(resumed.length, 40);
    assert.equal(new Set(resumed).size, 40);
    assert.deepEqual(resumed.slice(0, 5), rows);
  } finally {
    await e.close();
    store.close();
  }
});
test("Node limits allow 32 sockets; browser retains the six-connection ceiling", async () => {
  const store = new NodeStore(":memory:");
  try {
    assert.throws(() => new LookupEngine(store, { rdapConcurrency: 32 }));
    const e = new LookupEngine(store, {}, providers, "node");
    assert.equal(e.rdap.limit, 32);
    assert.equal(e.dns.cloudflare.rate, 32);
    assert.equal(e.dns.google.rate, 32);
    await e.close();
  } finally {
    store.close();
  }
});
test("A second CLI cannot interleave session commits in the same cache", () => {
  const dir = mkdtempSync(join(tmpdir(), "bne-lock-")),
    path = join(dir, "cache.sqlite");
  const first = new NodeStore(path);
  try {
    assert.throws(() => new NodeStore(path), /Another CLI/);
  } finally {
    first.close();
  }
  const next = new NodeStore(path);
  next.close();
  rmSync(dir, { recursive: true, force: true });
});
