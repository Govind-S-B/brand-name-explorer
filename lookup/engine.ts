import type { DnsRow, DomainRow, LookupStore } from "./store";
import {
  liveProviders,
  type DnsProvider,
  type DnsResult,
  type Providers,
  type RdapResult,
} from "./providers";
export interface LookupOptions {
  rdapConcurrency: number;
  rdapRate: number;
  dnsConcurrency: number;
  dnsRate: number;
  dnsTimeout: number;
  rdapTimeout: number;
  hedgeDelay: number;
  dns: boolean;
}
export const DEFAULT_LOOKUP: LookupOptions = {
  rdapConcurrency: 6,
  rdapRate: 30,
  dnsConcurrency: 12,
  dnsRate: 40,
  dnsTimeout: 2000,
  rdapTimeout: 8000,
  hedgeDelay: 250,
  dns: true,
};
export const NODE_LOOKUP: LookupOptions = {
  ...DEFAULT_LOOKUP,
  rdapConcurrency: 32,
  rdapRate: 160,
  dnsConcurrency: 32,
  dnsRate: 160,
};
export class Gate {
  active = 0;
  next = 0;
  cooldown = 0;
  successes = 0;
  rate: number;
  limit: number;
  constructor(
    public maximum: number,
    public capacity: number,
    start = 16,
  ) {
    this.rate = Math.min(start, maximum);
    this.limit = capacity;
  }
  available(now: number) {
    return this.active < this.limit && now >= this.next && now >= this.cooldown;
  }
  enter(now: number) {
    this.active++;
    this.next = now + 1000 / this.rate;
  }
  success() {
    if (++this.successes >= 20) {
      this.rate = Math.min(this.maximum, this.rate * 1.25);
      this.successes = 0;
    }
  }
  pause(until: number, throttled = false) {
    this.cooldown = Math.max(this.cooldown, until);
    this.successes = 0;
    if (throttled) this.rate = Math.max(0.25, this.rate / 2);
  }
}
interface Job {
  domain: string;
  key: string;
  fresh: number;
  priority: boolean;
  stats: LookupEngine["stats"];
  aborter: AbortController;
  stage: "reading" | "dns" | "rdap" | "saving" | "done";
  dnsStarted: number;
  dnsRunning: boolean;
  attempt: number;
  notBefore: number;
  resolve: (row: DomainRow) => void;
  reject: (e: unknown) => void;
}
function lookupStats() {
  return {
    rdap: 0,
    dns: 0,
    skipped: 0,
    retries: 0,
    cacheHits: 0,
    dnsCacheHits: 0,
    dnsErrors: 0,
    hedges: 0,
    congestion: 0,
    throttles: 0,
  };
}
export class LookupEngine {
  readonly options: LookupOptions;
  readonly rdap: Gate;
  readonly dns: { cloudflare: Gate; google: Gate };
  stats = lookupStats();
  private detailStats = lookupStats();
  private jobs = new Map<string, Job>();
  private promises = new Map<string, Promise<DomainRow>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private closing?: Promise<void>;
  private aborter = new AbortController();
  private tasks = new Set<Promise<void>>();
  private failures: boolean[] = [];
  private healthy = 0;
  private initialized: Promise<void>;
  constructor(
    private store: LookupStore,
    options: Partial<LookupOptions> = {},
    private providers: Providers = liveProviders,
    runtime: "browser" | "node" = "browser",
  ) {
    this.options = {
      ...(runtime === "node" ? NODE_LOOKUP : DEFAULT_LOOKUP),
      ...options,
    };
    const o = this.options;
    if (
      !Number.isInteger(o.rdapConcurrency) ||
      o.rdapConcurrency < 1 ||
      o.rdapConcurrency > (runtime === "node" ? 64 : 6) ||
      !Number.isInteger(o.dnsConcurrency) ||
      o.dnsConcurrency < 1 ||
      o.dnsConcurrency > (runtime === "node" ? 64 : 24) ||
      !Number.isFinite(o.rdapRate) ||
      o.rdapRate <= 0 ||
      o.rdapRate > (runtime === "node" ? 320 : 160) ||
      !Number.isFinite(o.dnsRate) ||
      o.dnsRate <= 0 ||
      o.dnsRate > 160 ||
      !Number.isFinite(o.dnsTimeout) ||
      o.dnsTimeout < 100 ||
      o.dnsTimeout > 30000 ||
      !Number.isFinite(o.rdapTimeout) ||
      o.rdapTimeout < 100 ||
      o.rdapTimeout > 30000 ||
      !Number.isFinite(o.hedgeDelay) ||
      o.hedgeDelay < 0 ||
      o.hedgeDelay > 30000
    )
      throw new Error("Invalid lookup limits");
    this.rdap = new Gate(
      o.rdapRate,
      o.rdapConcurrency,
      runtime === "node" ? 32 : 8,
    );
    this.dns = {
      cloudflare: new Gate(
        o.dnsRate,
        o.dnsConcurrency,
        runtime === "node" ? 32 : 16,
      ),
      google: new Gate(
        o.dnsRate,
        o.dnsConcurrency,
        runtime === "node" ? 32 : 16,
      ),
    };
    this.initialized = Promise.all(
      ["rdap", "cloudflare", "google"].map(async (p) => {
        const until = await store.getCooldown(p);
        (p === "rdap" ? this.rdap : this.dns[p as DnsProvider]).cooldown =
          until;
      }),
    ).then(() => {});
  }
  private provider(domain: string): DnsProvider {
    let hash = 0;
    for (const c of domain)
      hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
    return hash % 2 ? "google" : "cloudflare";
  }
  get(domain: string, fresh = 0, priority = false): Promise<DomainRow> {
    domain = domain.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.com$/.test(domain))
      return Promise.reject(new Error("Invalid .com domain"));
    if (this.closed)
      return Promise.reject(new DOMException("Lookup paused", "AbortError"));
    const key = domain + "/" + fresh;
    const existing = this.promises.get(key);
    if (existing) {
      if (priority) this.jobs.get(key)!.priority = true;
      return existing;
    }
    const result = new Promise<DomainRow>((resolve, reject) => {
      const job: Job = {
        domain,
        key,
        fresh,
        priority,
        aborter: new AbortController(),
        // Explicit checks share provider limits, but not the feed's counters.
        stats: priority ? this.detailStats : this.stats,
        stage: "reading",
        dnsStarted: 0,
        dnsRunning: false,
        attempt: 0,
        notBefore: 0,
        resolve,
        reject,
      };
      this.jobs.set(key, job);
      this.track(this.read(job).catch((e) => this.fail(job, e)));
    });
    this.promises.set(key, result);
    result.catch(() => {});
    return result;
  }
  private async read(job: Job) {
    await this.initialized;
    if (this.closed || job.stage === "done") return;
    const saved = await this.store.getDomain(job.domain);
    if (this.closed || this.jobs.get(job.key) !== job) return;
    if (saved && saved.checkedAt >= job.fresh) {
      job.stats.cacheHits++;
      this.finish(job, { ...saved, source: "cache" });
      return;
    }
    if (this.options.dns) {
      const dns = await this.store.getDns(job.domain);
      if (this.closed || this.jobs.get(job.key) !== job) return;
      if (dns && dns.expiresAt > Date.now() && dns.checkedAt >= job.fresh) {
        job.stats.dnsCacheHits++;
        if (dns.outcome === "ns") {
          const row: DomainRow = {
            domain: job.domain,
            status: "registered",
            checkedAt: dns.checkedAt,
            source: "dns",
          };
          job.stage = "saving";
          await this.store.saveDomain(row);
          job.stats.skipped++;
          this.finish(job, row);
          return;
        }
        job.stage = "rdap";
      } else job.stage = "dns";
    } else job.stage = "rdap";
    this.wake();
  }
  private track(task: Promise<void>) {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => {});
  }
  private finish(job: Job, row: DomainRow) {
    if (job.stage === "done") return;
    job.stage = "done";
    this.jobs.delete(job.key);
    this.promises.delete(job.key);
    if (!this.closed) job.resolve(row);
    this.wake();
  }
  private fail(job: Job, error: unknown) {
    if (job.stage === "done") return;
    job.stage = "done";
    this.jobs.delete(job.key);
    this.promises.delete(job.key);
    job.reject(error);
    this.wake();
  }
  private wake() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, 0);
  }
  private pump() {
    if (this.closed) return;
    const now = Date.now();
    let wait = Infinity;
    for (const job of this.jobs.values())
      if (
        job.stage === "dns" &&
        this.dns[this.provider(job.domain)].cooldown > now
      )
        job.stage = "rdap";
    const ready = [...this.jobs.values()]
      .filter((j) => j.stage === "rdap" && j.notBefore <= now)
      .sort(
        (a, b) =>
          Number(b.priority) - Number(a.priority) || b.attempt - a.attempt,
      );
    while (ready.length && this.rdap.available(Date.now()))
      this.startRdap(ready.shift()!, false);
    for (const job of [...this.jobs.values()].sort(
      (a, b) => Number(b.priority) - Number(a.priority),
    )) {
      if (job.stage === "dns" && !job.dnsRunning) {
        const gate = this.dns[this.provider(job.domain)];
        if (gate.available(Date.now())) this.startDns(job);
      }
    }
    const pendingRdap = [...this.jobs.values()].some(
      (j) => j.stage === "rdap" && j.notBefore <= now,
    );
    if (!pendingRdap && this.rdap.available(Date.now())) {
      const pending = [...this.jobs.values()].find(
        (j) =>
          j.stage === "dns" &&
          j.dnsRunning &&
          now - j.dnsStarted >= this.options.hedgeDelay,
      );
      if (pending) this.startRdap(pending, true);
    }
    for (const job of this.jobs.values()) {
      if (job.stage === "rdap" && this.rdap.active < this.rdap.limit)
        wait = Math.min(
          wait,
          Math.max(
            1,
            job.notBefore - now,
            this.rdap.next - now,
            this.rdap.cooldown - now,
          ),
        );
      if (job.stage === "dns") {
        const gate = this.dns[this.provider(job.domain)];
        if (!job.dnsRunning && gate.active < gate.limit)
          wait = Math.min(
            wait,
            Math.max(1, gate.next - now, gate.cooldown - now),
          );
        if (
          job.dnsRunning &&
          this.rdap.active < this.rdap.limit &&
          !pendingRdap
        )
          wait = Math.min(
            wait,
            Math.max(
              1,
              job.dnsStarted + this.options.hedgeDelay - now,
              this.rdap.next - now,
              this.rdap.cooldown - now,
            ),
          );
      }
    }
    if (Number.isFinite(wait))
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
  }
  private startDns(job: Job) {
    const provider = this.provider(job.domain),
      gate = this.dns[provider];
    gate.enter(Date.now());
    job.dnsRunning = true;
    job.dnsStarted = Date.now();
    job.stats.dns++;
    const signal = AbortSignal.any([
      this.aborter.signal,
      job.aborter.signal,
      AbortSignal.timeout(this.options.dnsTimeout),
    ]);
    const task = (async () => {
      let result: DnsResult;
      try {
        result = await this.providers.dns(job.domain, provider, signal);
      } catch (e) {
        if (this.closed) return;
        result = {
          outcome: "error",
          error: signal.aborted ? "DNS timeout" : "Resolver failure",
        };
      }
      if (this.closed || job.stage === "done") return;
      const now = Date.now();
      if (["ns", "nxdomain", "no_ns"].includes(result.outcome)) {
        const dns: DnsRow = {
          domain: job.domain,
          outcome: result.outcome as DnsRow["outcome"],
          checkedAt: now,
          expiresAt: now + (result.ttl || 0) * 1000,
          provider,
        };
        if (result.outcome === "ns" && job.stage === "dns") {
          job.stage = "saving";
          const row: DomainRow = {
            domain: job.domain,
            status: "registered",
            checkedAt: now,
            source: "dns",
          };
          await this.store.saveDns(dns, row);
          job.stats.skipped++;
          this.finish(job, row);
        } else {
          await this.store.saveDns(dns);
          if (job.stage === "dns") job.stage = "rdap";
        }
        gate.success();
      } else {
        job.stats.dnsErrors++;
        if (result.throttled || result.retryAfter) {
          const until = now + Math.max(2000, result.retryAfter || 0);
          gate.pause(until, result.throttled);
          job.stats.throttles += Number(Boolean(result.throttled));
          await this.store.setCooldown(provider, gate.cooldown);
        }
        if (job.stage === "dns") job.stage = "rdap";
      }
    })()
      .catch((e) => this.fail(job, e))
      .finally(() => {
        gate.active--;
        this.wake();
      });
    this.track(task);
  }
  private observe(failed: boolean, stats: LookupEngine["stats"]) {
    this.failures.push(failed);
    if (this.failures.length > 64) this.failures.shift();
    this.healthy = failed ? 0 : this.healthy + 1;
    if (
      this.failures.length >= 32 &&
      this.failures.filter(Boolean).length >=
        Math.max(4, 0.1 * this.failures.length)
    ) {
      this.rdap.limit = Math.max(1, Math.floor(this.rdap.limit * 0.75));
      this.rdap.rate = Math.max(1, this.rdap.rate * 0.75);
      this.rdap.successes = 0;
      stats.congestion++;
      this.failures = [];
    } else if (this.healthy >= 64) {
      this.rdap.limit = Math.min(
        this.options.rdapConcurrency,
        this.rdap.limit + 1,
      );
      this.healthy = 0;
    }
  }
  private startRdap(job: Job, hedge: boolean) {
    this.rdap.enter(Date.now());
    job.stage = "saving";
    job.stats.rdap++;
    job.stats.retries += Number(job.attempt > 0);
    job.stats.hedges += Number(hedge);
    const signal = AbortSignal.any([
      this.aborter.signal,
      job.aborter.signal,
      AbortSignal.timeout(this.options.rdapTimeout),
    ]);
    const task = (async () => {
      let result: RdapResult;
      try {
        result = await this.providers.rdap(job.domain, signal);
      } catch (e) {
        if (this.closed) return;
        result = {
          error: signal.aborted ? "RDAP timeout" : "Network failure",
          retryable: true,
          networkFailure: true,
        };
      }
      if (this.closed || job.stage === "done") return;
      this.observe(Boolean(result.error), job.stats);
      if (result.status) {
        const row: DomainRow = {
          domain: job.domain,
          status: result.status,
          checkedAt: Date.now(),
          source: "rdap",
        };
        await this.store.saveDomain(row);
        this.rdap.success();
        this.finish(job, row);
        return;
      }
      const delay = Math.max(
        result.retryAfter || 0,
        Math.min(60000, 2 ** (job.attempt + 1) * 1000) + Math.random() * 1000,
      );
      if (result.throttled || result.providerFailure || result.retryAfter) {
        this.rdap.pause(Date.now() + delay, result.throttled);
        job.stats.throttles += Number(Boolean(result.throttled));
        await this.store.setCooldown("rdap", this.rdap.cooldown);
      }
      if (
        !result.retryable ||
        job.attempt + 1 >= (result.networkFailure ? 6 : 3)
      ) {
        this.fail(
          job,
          new Error(
            `${job.domain}: ${result.error} after ${job.attempt + 1} attempts. Progress saved; resume to retry.`,
          ),
        );
        return;
      }
      job.attempt++;
      job.notBefore = Date.now() + delay;
      job.stage = "rdap";
    })()
      .catch((e) => this.fail(job, e))
      .finally(() => {
        this.rdap.active--;
        this.wake();
      });
    this.track(task);
  }
  get stopped() {
    return this.closed;
  }
  cancelBackground() {
    for (const job of [...this.jobs.values()])
      if (!job.priority) {
        job.aborter.abort();
        this.fail(job, new DOMException("Lookup paused", "AbortError"));
      }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.aborter.abort();
    for (const job of [...this.jobs.values()])
      this.fail(
        job,
        new DOMException("Lookup paused; resume to continue", "AbortError"),
      );
    this.closing = Promise.allSettled([...this.tasks]).then(() => {});
    return this.closing;
  }
}
