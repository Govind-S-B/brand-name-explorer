import { test } from "node:test";
import assert from "node:assert/strict";
import { LookupEngine, Gate } from "../lookup/engine";
import {
  interpretRdap,
  interpretDns,
  retryAfter,
  type Providers,
} from "../lookup/providers";
import type { DnsRow, DomainRow, LookupStore } from "../lookup/store";
class MemoryStore implements LookupStore {
  domains = new Map<string, DomainRow>();
  dns = new Map<string, DnsRow>();
  cooldowns = new Map<string, number>();
  fail = false;
  async getDomain(d: string) {
    return this.domains.get(d);
  }
  async getDns(d: string) {
    return this.dns.get(d);
  }
  async saveDomain(r: DomainRow) {
    if (this.fail) throw new Error("disk full");
    this.domains.set(r.domain, r);
  }
  async saveDns(r: DnsRow, d?: DomainRow) {
    if (this.fail) throw new Error("disk full");
    this.dns.set(r.domain, r);
    if (d) this.domains.set(d.domain, d);
  }
  async getCooldown(p: string) {
    return this.cooldowns.get(p) || 0;
  }
  async setCooldown(p: string, u: number) {
    this.cooldowns.set(p, Math.max(this.cooldowns.get(p) || 0, u));
  }
}
const providers: Providers = {
  async rdap() {
    return { status: "possibly available" };
  },
  async dns() {
    return { outcome: "nxdomain", ttl: 300 };
  },
};
function fast(
  store: MemoryStore,
  overrides: Partial<Providers> = {},
  options = {},
) {
  const e = new LookupEngine(store, options, { ...providers, ...overrides });
  e.rdap.rate = 100000;
  e.dns.cloudflare.rate = e.dns.google.rate = 100000;
  return e;
}
test("Only validated RDAP responses can be available", () => {
  assert.equal(
    interpretRdap(404, "", "alpha.com", "application/rdap+json").status,
    "possibly available",
  );
  assert.equal(
    interpretRdap(404, "<html>", "alpha.com", "text/html").status,
    undefined,
  );
  assert.equal(interpretRdap(404, "", "alpha.com", "").status, undefined);
  assert.equal(
    interpretRdap(
      200,
      '{"ldhName":"other.com"}',
      "alpha.com",
      "application/json",
    ).status,
    undefined,
  );
  assert.equal(
    interpretRdap(404, '{"errorCode":404}', "alpha.com", "application/json")
      .status,
    "possibly available",
  );
  assert.equal(
    interpretRdap(429, "", "alpha.com", "", "120").retryAfter,
    120000,
  );
  assert.equal(retryAfter("bad"), 0);
});
test("DNS accepts exact NS answers, rejects authority-only and mismatched questions", () => {
  const data = {
    Status: 0,
    Question: [{ name: "alpha.com.", type: 2 }],
    Answer: [{ name: "alpha.com.", type: 2, TTL: 60, data: "ns.example." }],
  };
  assert.deepEqual(interpretDns(200, data, "alpha.com"), {
    outcome: "ns",
    ttl: 60,
  });
  assert.equal(
    interpretDns(
      200,
      { ...data, Answer: [], Authority: data.Answer },
      "alpha.com",
    ).outcome,
    "no_ns",
  );
  assert.equal(interpretDns(200, data, "other.com").outcome, "error");
  assert.equal(
    interpretDns(200, { ...data, Status: 3, Answer: [] }, "alpha.com").outcome,
    "nxdomain",
  );
  assert.equal(
    interpretDns(200, { ...data, TC: true }, "alpha.com").outcome,
    "error",
  );
  assert.equal(
    interpretDns(200, { ...data, Status: 2 }, "alpha.com").outcome,
    "error",
  );
});
test("DNS-positive skip and negative RDAP confirmation; deduplicate in-flight jobs", async () => {
  const store = new MemoryStore();
  let calls = 0;
  const engine = fast(store, {
    async dns(d) {
      return { outcome: d === "alpha.com" ? "ns" : "nxdomain", ttl: 60 };
    },
    async rdap() {
      calls++;
      return { status: "registered" };
    },
  });
  try {
    const p = engine.get("alpha.com");
    assert.equal(p, engine.get("alpha.com"));
    const rows = await Promise.all([p, engine.get("bravo.com")]);
    assert.deepEqual(
      rows.map((r) => r.status),
      ["registered", "registered"],
    );
    assert.equal(calls, 1);
    assert.equal(store.domains.size, 2);
    assert.equal(store.dns.size, 2);
    assert.equal(engine.stats.skipped, 1);
    assert.equal((await engine.get("alpha.com")).source, "cache");
  } finally {
    await engine.close();
  }
});
test("DNS errors and exceptions preserve coverage through RDAP", async () => {
  const store = new MemoryStore(),
    engine = fast(store, {
      async dns() {
        throw new Error("SERVFAIL");
      },
    });
  try {
    assert.equal((await engine.get("alpha.com")).status, "possibly available");
    assert.equal(engine.stats.dnsErrors, 1);
    assert.equal(store.dns.size, 0);
  } finally {
    await engine.close();
  }
});
test("Warm and fresh DNS evidence resume pending RDAP work, refresh bypasses it", async () => {
  const store = new MemoryStore();
  store.dns.set("alpha.com", {
    domain: "alpha.com",
    outcome: "nxdomain",
    checkedAt: Date.now(),
    expiresAt: Date.now() + 10000,
    provider: "cloudflare",
  });
  const engine = fast(store);
  try {
    await engine.get("alpha.com");
    assert.equal(engine.stats.dns, 0);
    assert.equal(engine.stats.rdap, 1);
    assert.equal(engine.stats.dnsCacheHits, 1);
    await engine.get("alpha.com", Date.now() + 1);
    assert.equal(engine.stats.dns, 1);
  } finally {
    await engine.close();
  }
});
test("Failed durable commit cannot publish any successful row", async () => {
  const store = new MemoryStore();
  store.fail = true;
  const engine = fast(store, {
    async dns() {
      return { outcome: "ns", ttl: 60 };
    },
  });
  try {
    await assert.rejects(engine.get("alpha.com"), /disk full/);
    assert.equal(store.domains.size, 0);
  } finally {
    await engine.close();
  }
});
test("RDAP cooldown does not consume DNS budget, DNS cooldown falls through", async () => {
  const store = new MemoryStore();
  store.cooldowns.set("rdap", Date.now() + 60000);
  const engine = fast(store, {
    async dns() {
      return { outcome: "ns", ttl: 60 };
    },
  });
  try {
    assert.equal((await engine.get("alpha.com")).status, "registered");
    assert.equal(engine.stats.rdap, 0);
  } finally {
    await engine.close();
  }
  store.cooldowns.clear();
  store.cooldowns.set("cloudflare", Date.now() + 60000);
  store.cooldowns.set("google", Date.now() + 60000);
  const next = fast(store);
  try {
    await next.get("bravo.com");
    assert.equal(next.stats.dns, 0);
    assert.equal(next.stats.rdap, 1);
  } finally {
    await next.close();
  }
});
test("An idle RDAP slot can hedge slow DNS, and late DNS cannot override RDAP", async () => {
  const store = new MemoryStore();
  let release!: (v: any) => void;
  const pending = new Promise<any>((r) => (release = r));
  const engine = fast(
    store,
    {
      async dns() {
        return pending;
      },
    },
    { hedgeDelay: 0 },
  );
  try {
    const row = await engine.get("alpha.com");
    assert.equal(row.status, "possibly available");
    assert.equal(engine.stats.hedges, 1);
    release({ outcome: "ns", ttl: 60 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.domains.get("alpha.com")?.status, "possibly available");
  } finally {
    release({ outcome: "ns", ttl: 60 });
    await engine.close();
  }
});
test("DNS hangs are bounded and RDAP has its own timeout", async () => {
  const hanging = (_d: string, _p: any, signal: AbortSignal) =>
    new Promise<never>((_r, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  const engine = fast(
    new MemoryStore(),
    { dns: hanging },
    { dnsTimeout: 100, hedgeDelay: 30000 },
  );
  try {
    assert.equal((await engine.get("alpha.com")).status, "possibly available");
    assert.equal(engine.stats.dnsErrors, 1);
  } finally {
    await engine.close();
  }
});
test("Cancellation releases queued work and rejects pending callers", async () => {
  const store = new MemoryStore();
  store.cooldowns.set("rdap", Date.now() + 60000);
  const engine = fast(store, {}, { dns: false });
  const promise = engine.get("alpha.com");
  await new Promise((r) => setTimeout(r, 10));
  await engine.close();
  await assert.rejects(promise, (e) => (e as Error).name === "AbortError");
  assert.equal(store.domains.size, 0);
});
test("Retries release the only RDAP slot and stay bounded", async () => {
  const calls: string[] = [];
  let first = true;
  const engine = fast(
    new MemoryStore(),
    {
      async rdap(d) {
        calls.push(d);
        if (d === "alpha.com" && first) {
          first = false;
          return { error: "reset", retryable: true };
        }
        return { status: "registered" };
      },
    },
    { dns: false, rdapConcurrency: 1 },
  );
  try {
    await Promise.all([engine.get("alpha.com"), engine.get("bravo.com")]);
    assert.deepEqual(calls, ["alpha.com", "bravo.com", "alpha.com"]);
    assert.equal(engine.stats.retries, 1);
  } finally {
    await engine.close();
  }
});
test("Pacing, backoff, and limits remain independent and validated", () => {
  const gate = new Gate(40, 6);
  assert.equal(gate.rate, 16);
  gate.enter(100);
  assert.equal(gate.available(110), false);
  for (let i = 0; i < 20; i++) gate.success();
  assert.equal(gate.rate, 20);
  gate.pause(5000, true);
  assert.equal(gate.rate, 10);
  assert.equal(gate.available(4999), false);
  assert.throws(
    () => new LookupEngine(new MemoryStore(), { rdapConcurrency: 7 }),
  );
});

test("A DoH 429 persists only that resolver cooldown and still reaches RDAP", async () => {
  const store = new MemoryStore();
  const engine = fast(store, {
    async dns() {
      return {
        outcome: "error",
        error: "HTTP 429",
        throttled: true,
        retryAfter: 60000,
      };
    },
  });
  try {
    assert.equal((await engine.get("alpha.com")).status, "possibly available");
    assert.equal(engine.stats.throttles, 1);
    assert.ok(
      [...store.cooldowns.entries()].some(
        ([key, until]) => key !== "rdap" && until > Date.now() + 59000,
      ),
    );
    assert.equal(engine.rdap.cooldown, 0);
  } finally {
    await engine.close();
  }
});

test("Persistent HTTP overload exhausts three attempts without caching availability", async () => {
  const store = new MemoryStore();
  const engine = fast(
    store,
    {
      async rdap() {
        return { error: "HTTP 503", retryable: true, providerFailure: true };
      },
    },
    { dns: false },
  );
  try {
    await assert.rejects(engine.get("alpha.com"), /after 3 attempts/);
    assert.equal(engine.stats.rdap, 3);
    assert.equal(store.domains.size, 0);
    assert.ok((store.cooldowns.get("rdap") || 0) > Date.now());
  } finally {
    await engine.close();
  }
});

test("Correlated errors reduce concurrency and a healthy run recovers it", async () => {
  const store = new MemoryStore();
  let failing = true;
  const engine = fast(
    store,
    {
      async rdap() {
        return failing ? { error: "HTTP 403" } : { status: "registered" };
      },
    },
    { dns: false },
  );
  engine.rdap.maximum = 100000;
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 64 }, (_, i) => engine.get(`failed${i}.com`)),
    );
    assert.ok(results.every((r) => r.status === "rejected"));
    assert.ok(engine.stats.congestion > 0);
    assert.ok(engine.rdap.limit < 6);
    failing = false;
    await Promise.all(
      Array.from({ length: 400 }, (_, i) => engine.get(`healthy${i}.com`)),
    );
    assert.equal(engine.rdap.limit, 6);
    assert.equal(store.domains.size, 400);
  } finally {
    await engine.close();
  }
});

test("Explicit checks take the next provider slot without changing feed counters", async () => {
  const store = new MemoryStore(),
    calls: string[] = [];
  let active = 0,
    maximum = 0;
  const engine = fast(
    store,
    {
      async rdap(domain) {
        calls.push(domain);
        maximum = Math.max(maximum, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { status: "registered" };
      },
    },
    { dns: false, rdapConcurrency: 1 },
  );
  try {
    const feed = Array.from({ length: 10 }, (_, i) =>
      engine.get(`feed${i}.com`),
    );
    const detail = engine.get("detail.com", Date.now(), true);
    await Promise.all([...feed, detail]);
    assert.equal(calls[0], "detail.com");
    assert.equal(maximum, 1);
    assert.equal(engine.stats.rdap, 10);
    assert.equal(store.domains.size, 11);
  } finally {
    await engine.close();
  }
});

test("Finishing a feed cancels speculation while explicit checks finish and save", async () => {
  const store = new MemoryStore();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const ready = new Promise<void>((r) => (release = r));
  const engine = fast(
    store,
    {
      async rdap(domain, signal) {
        if (domain === "detail.com") await ready;
        else {
          entered();
          await new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        }
        return { status: "possibly available" };
      },
    },
    { dns: false },
  );
  try {
    const detail = engine.get("detail.com", Date.now(), true);
    const feed = engine.get("background.com");
    await started;
    const rejected = assert.rejects(feed, { name: "AbortError" });
    engine.cancelBackground();
    release();
    await rejected;
    assert.equal((await detail).status, "possibly available");
    assert.equal(store.domains.has("background.com"), false);
    assert.equal(store.domains.has("detail.com"), true);
  } finally {
    release();
    await engine.close();
  }
});

test("Repeated close waits for provider cleanup before a replacement engine starts", async () => {
  let entered!: () => void, cleanup!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const engine = fast(
    new MemoryStore(),
    {
      async rdap(_, signal) {
        entered();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              cleanup = resolve;
            },
            { once: true },
          );
        });
        return { status: "registered" };
      },
    },
    { dns: false },
  );
  const lookup = engine.get("alpha.com");
  await started;
  const rejection = assert.rejects(lookup, { name: "AbortError" });
  const first = engine.close(),
    second = engine.close();
  assert.equal(first, second);
  let closed = false;
  void second.then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  cleanup();
  await second;
  await rejection;
  assert.equal(closed, true);
});
