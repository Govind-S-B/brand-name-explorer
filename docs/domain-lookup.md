# Domain lookup engine

The engine pre-filters `.com` with live DNS-over-HTTPS NS queries, then confirms
all potential availability directly against Verisign RDAP, without credentials.
An exact NS answer skips RDAP and records registration. DNS negatives and errors
fall through to RDAP. See [DNS behavior and measured comparisons](domain-lookup-dns.md)
for independent DNS scheduling, caching, correctness checks, and reproduction.
It keeps seeded output order and complete filtered pages while scheduling network
requests independently of output and retry delays. The default is **32 workers,
a 160-attempt/second ceiling, and a starting rate of 16**. A ceiling is a budget,
not a promised throughput or provider quota.

## Execution and recovery

1. Read domain records in indexed batches of up to 256. Warm hits do not create
   a TLS client or start the network dispatcher.
2. Deduplicate pending checks by domain and freshness requirement.
3. Uncached names enter the DNS queue first. A single dispatcher services separate
   DNS and RDAP pools and rate limiters; a slow DNS query occupies no RDAP worker.
   Matching NS answers complete registered results; other DNS outcomes enter
   the existing RDAP queue. Workers do no rate-limit or retry sleeping.
4. Completed responses return to the dispatcher. Successful rows are committed
   in a transaction before consumers can see them. New work continues even if
   an earlier response is slow.
5. Failed attempts enter a timer heap. Due retries take priority over new checks,
   without reserving a worker while waiting.
6. Consume completed results in generation order. Registered results free room
   for further checks. Pending possible matches are counted against the number
   still needed, so filling a page does not trigger an exhaustive scan.
7. Append session matches and update the cursor transactionally. Displayed rows
   are committed before yielding; undisplayed prefixes checkpoint every 256
   candidates and at completion/error. Saved pages are read by indexed slice.

Lookahead is bounded to `max(1024, 32 × workers)` source rows (one in serial mode).
A sufficiently long earlier failure can still fill that bound. It deliberately
prevents unlimited speculative work while retaining ordered pagination.
Cancellation stops queued work and retry timers; active requests can finish and
be cached. Socket operations have a five-second timeout; that is **not a total
wall-clock deadline** across DNS, connect, TLS, headers, and body.

## Tuning and congestion

| Control | Default | Allowed range |
| --- | ---: | --- |
| `--lookup-workers` | 32 | 1–64 |
| `--lookup-rate` | 160 | >0–320 attempts/second, shared by all workers |

Start at `min(16, ceiling)`, then increase 25% per 20 successes. HTTP 429 halves
the rate; HTTP overload and `Retry-After` pause the shared dispatcher. Server
cooldowns are persisted across restarts, including numeric/date `Retry-After`.
Retries consume the same rate budget as new attempts.

Isolated connection failures do not pause everyone. Correlated failures (at
least four, and at least 10% of a 32–64-response window) reduce active concurrency
and the current rate by 25%. After 128 healthy responses, concurrency recovers
in bounded steps. A stale reused connection is excluded from this congestion
signal. This controller is intentionally bounded; it is not a proof of globally
optimal pacing under every network condition.

Transport errors receive at most **six attempts**; other retryable failures
receive three. Retry delay is exponential plus jitter, capped at 60 seconds;
a longer server-specified delay is respected. Permanent HTTP errors stop without
repeated retries. An unresolved earlier name stops ordered pagination and keeps
its position for resume. Unknown results are never available results.

The HTTP client shares TLS configuration. Where reuse works it keeps one
connection per worker. In this environment the second request on a reused
connection consistently returned `RemoteDisconnected`, so the client detects
that and reconnects for subsequent requests. HTTP/2 ALPN was not negotiated here.

Transport hostname resolution (distinct from the domain NS pre-filter) is shared
and cached for five minutes per client. Refresh runs in the
background using the previous answers while it is pending; a failed refresh
can use those answers temporarily. An initial resolution has a bounded wait.
The registry's own returned addresses are ranked once by small TCP-connect
probes, avoiding pinning every cached lookup to an unnecessarily slow first
address. TLS still verifies `rdap.verisign.com`; this does not rotate providers,
IPs, or identities to bypass throttling.

## Durable cache and compatibility

`--cache domain_cache.json` selects `domain_cache.sqlite3`. Legacy successful
JSON records import once; the original file is untouched. Explicit `.sqlite3`,
`.sqlite`, and `.db` selectors work directly. Domain records use SQLite WAL and
normal durable commits. Completion batches amortize writes without disabling
synchronisation or publishing results before commit.

Saved session hashes are unchanged. Each session now uses a sibling SQLite file
inside `<cache-stem>_sessions/`. Existing session JSON imports once, preserving
its original contents. Matching rows and cursors are committed together;
there is no repeated full-history JSON rewrite. Previously saved rows are read
only for the requested page. `--refresh` replaces the current session with a
new freshness boundary; other sessions stay unchanged. Snapshot pages do not
silently expire. One process per cache/session is supported; rate coordination
is per process.

Runtime databases, sidecars, old caches, and session directories are gitignored.
`--no-check-com` performs no lookup/cache IO and bypasses availability filtering.
A generic HTML/empty 404 is not enough: availability requires the validated RDAP
404 response. A 200 must identify the requested domain. “Possibly available”
is absence of a registration record, not a registrar purchase guarantee.

## RDAP-only measurements before the NS pre-filter

These are sequential measurements on this machine on 12 November 2026, not a
controlled multi-region study. Live runs used calm/6/seed-42, separate empty
local caches, and registered domains hidden. Remote caches were not controlled.
Every completed 1,000-name run checked the same 2,236 candidates in the same order.

| Implementation / setting | Available names | Seconds | What it shows |
| --- | ---: | ---: | --- |
| Final default, 32 workers / cap 160 | 200 | 10.7 | 476 candidates, one recovered retry |
| Previous scheduler, 16 workers / cap 40 | 1,000 | 85.2–89.4 | Earlier best completed configuration |
| New dispatcher, same workers/rate and old ramp | 1,000 | 80.9 | Scheduling alone improves utilization |
| New dispatcher, 16 workers / cap 60, old ramp | 1,000 | 62.5 | Higher pacing now completes |
| New dispatcher, 32 workers / cap 160, start 16 | 1,000 | 23.9 | Faster ramp and useful concurrency |
| New dispatcher, 64 workers / cap 320 | 1,000 | 20.0 | Short-run peak; not sustained default |
| New dispatcher, 64 workers / cap 640 | 1,000 | 20.9 | More pacing budget stopped helping |
| New dispatcher, 128 workers / cap 640 | 446, partial | 12.9 | Sustained p95 degradation; exploratory stop |

At 128 workers, the last latency windows rose through 1.58, 1.87, 2.61 and 2.88
seconds. Throughput fell, rather than improving. Higher experimental settings
are restricted to the benchmark and are not normal CLI ranges.

Long runs revealed another limit: after thousands of fresh checks, correlated
transport timeouts can consume the short-run gain. These are actual completed
4,000-name searches (8,752 distinct candidates), including all recovery time:

| Setting / stage | Seconds | Recovered retries | Outcome |
| --- | ---: | ---: | --- |
| 64 workers / cap 320, early scheduler revision | 133.2 | 123 | Completed with transport stalls |
| 32 workers / cap 160, congestion recovery | 140.6 | 129 | Completed; concurrency reduced six times |
| 32 workers / cap 120, DNS-address ranking | 135.7 | 106 | Completed; congestion reduced five times |
| 32 workers / cap 80 | 138.8 | 7 | Completed without timeout bursts |

Thus the sustained observed limit in these runs was about **4,000 available names
in 2¼ minutes**, despite very different peak rates. No HTTP 429 was observed.
Timeout phases are now recorded in benchmark samples, but the origin of the
long-run stalls has not been conclusively isolated to registry vs. network vs.
intermediary. We do not claim an absolute maximum or a provider quota. The default
retains short-page performance, with automatic congestion recovery for long runs;
a lower rate can provide smoother progress without necessarily finishing faster.
An intermediate DNS-only revision exhausted its original three-attempt budget
at 3,608 displayed results; successful work remained cached. This motivated the
bounded longer transport recovery budget rather than calling that run complete.

### Controlled recovery and local cache

A simulated workload of 600 checks, including 60 first-attempt failures and one
slow earlier request, completed all 660 attempts in **2.6 seconds**, versus
**61.1 seconds** with the old implementation. This uses a synthetic transport;
it is evidence about retry scheduling, not registry performance.

With synthetic cached records and no network requests:

| Work | Before | Current |
| --- | ---: | ---: |
| Build page 20 from 8,000 cached candidates | 2.75 s | about 0.2 s |
| Build page 200 from 80,000 cached candidates | Not measured | about 0.7 s |
| Reopen page 200 from 40,000 saved matches | Not measured | about 0.006 s |

Twenty real saved pages were also verified: 4,000 unique names, identical ordering,
and zero HTTP requests. The 200-page cache test is synthetic; it is not a claim
that 40,000 live availability results were fetched.

## Reproduce

```bash
# New output directory required: normal cache remains untouched.
python3 scripts/benchmark_lookup.py --workers 32 --rate 160 --count 1000 --out .cache/bench-new
# Add --no-dns for the RDAP-only comparison. See domain-lookup-dns.md for all sizes.
python3 scripts/benchmark_cache.py
python3 scripts/benchmark_retries.py
python3 scripts/stress_lookup.py --out .cache/synthetic-stress.json
```

The live benchmark records request-level durations/failure phases, CPU time,
cache hits, retries, DNS statistics, congestion reductions, and exact output
order. `--experimental-rate` enables exploration-only ceilings up to 640 and
128 workers, with conservative pressure-stop guards. This mode stops on server
pressure, correlated errors, or three slow 100-response latency windows. Normal
runs recover through errors using the engine's bounded retry policy. Do not run
competing benchmark processes or bypass a persisted provider cooldown.

## Related implementations studied

- [tldx](https://github.com/brandonyoungdev/tldx): concurrent bulk availability
  checks with streamed results, a shared HTTP client and jittered retry backoff.
  Its completion-order streaming differs from our stable seeded pagination.
  Reviewed [resolver source](https://github.com/brandonyoungdev/tldx/blob/main/internal/resolver/resolver.go).
- [asyncwhois](https://github.com/pogzyb/asyncwhois) and its
  [whodap](https://github.com/pogzyb/whodap) RDAP backend: async interfaces and
  reusable clients/bootstrap caching; not a drop-in durable filtered-page engine.
- [domain-check](https://github.com/saidutt46/domain-check): Rust/Tokio domain
  checking with a reusable reqwest client and bounded timeouts. Its RDAP source
  uses a fixed retry delay and WHOIS fallback; those are not evidence of higher
  throughput for our specific `.com` workload.
- [Scrapy AutoThrottle](https://github.com/scrapy/scrapy/blob/master/scrapy/extensions/throttle.py):
  latency/concurrency-aware pacing and the principle that errors must not make
  the client accelerate. This informed congestion handling, without adding Scrapy.
- [OpenRDAP](https://github.com/openrdap/rdap): bootstrap discovery/caching and
  standards-based response handling. Direct `.com` lookup already avoids that
  discovery round trip.

These projects were inspected, not benchmarked head-to-head. No new package
runtime dependencies were added. Earlier experiments and their superseded
conclusions are retained in [the historical measurements](domain-lookup-history.md).
