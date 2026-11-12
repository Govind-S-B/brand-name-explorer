# Historical lookup experiments

These are measurements of earlier implementations. See [the current engine](domain-lookup.md) for current behavior and defaults.

# Faster unauthenticated .com checks

The lookup path uses Verisign's public RDAP endpoint, with no credentials or paid
provider. IANA lists it as the `.com` RDAP service. `rdap.org` redirects `.com`
requests there; it is not an independent capacity source. No DNS-negative result
or third-party mirror response is treated as domain availability.

## Execution

1. Return a cached result if it meets the current session's freshness requirement.
2. Deduplicate in-flight checks for the same domain and freshness requirement.
3. Dispatch uncached requests through one shared rate limiter and bounded worker pool.
4. Save successful responses immediately to SQLite, even when they finish out of order.
5. Consume results in generator order. A failed earlier check prevents the cursor
   from advancing past it; later successful checks remain cached for resumption.

Filtered browsing has at most `2 × workers` rows in its lookup window (one in
serial mode), shrinking as the page fills. This keeps workers busy when an earlier
request is slow. The next window is scheduled only as the consumer advances. At
most `2 × workers - 1` speculative checks can remain after the final required match.
Queued requests are cancelled when browsing stops. Already-running HTTP requests
can finish and be cached; shutdown can wait for their 15-second network timeout.
Unfiltered browsing schedules only the requested page.

This bounds excess work without scanning the complete generated space. If almost
every candidate is registered, finding enough matches can still require many
checks. The result sequence and page identity do not depend on completion order,
concurrency, or pacing.

## Controls and retry behavior

| Control | Default | Meaning |
| --- | --- | --- |
| `--lookup-workers` | 8 | Maximum concurrent requests, from 1 to 16 |
| `--lookup-rate` | 20 | Shared ceiling on request attempts/second, >0 to 20 |

The local ceiling is configurable, not a claim about Verisign's guaranteed
capacity. Dispatch starts at the smaller of 4 requests/second and the ceiling.
After each 20 successful responses, it increases by 25% up to the ceiling.
A shared cooldown resets this success count. On HTTP 429 it halves the rate, with a floor of 0.25 (or the configured
ceiling when lower), and pauses the provider queue. Retries also consume the
shared rate budget.

For transient failures, the retry delay uses the greater of `Retry-After` and
exponential delay plus random jitter. Both numeric seconds and HTTP dates are
supported. Connection failures delay only the affected job; HTTP 429, server
overload, and responses with `Retry-After` pause all workers. A server-requested delay is not shortened by the local backoff cap.
Throttling/header cooldowns are persisted in SQLite so restarting the CLI does
not discard them. Checks receive at most three attempts. Permanent errors such
as HTTP 403 are reported immediately rather than retried repeatedly.

Workers share one TLS configuration and each reuses its connection where possible. If a reused connection is
closed unexpectedly, the client reconnects under the shared rate budget without
the transient-error cooldown, and disables reuse for that run. This accommodates
endpoints or network intermediaries that close connections between requests.

Retries and cache hits are counted in the final lookup summary. Failures are not
cached as registered or available. Registered responses must identify the
requested domain. Not-found responses must be a valid RDAP error or Verisign's
empty `application/rdap+json` HTTP 404; a generic empty/HTML 404 is not accepted.

## Cache and migration

Successful records live in an indexed SQLite table, with one durable transaction
per result and WAL enabled. Updating one domain no longer rewrites all cached
domains. Runtime lookup reads one record at a time rather than loading the full
cache into memory.

The existing `--cache domain_cache.json` selector resolves to
`domain_cache.sqlite3`. If the database has not imported its legacy cache yet,
the JSON records are validated and imported transactionally. The original file
is preserved; subsequent checks update SQLite only. A failed import can be fixed
and retried. Explicit `.sqlite3`, `.sqlite`, and `.db` paths are supported directly.

Saved session filenames and sequence hashes are unchanged. Available matches are
checkpointed before display; rejected-name progress is checkpointed every 32
names and on normal stop/error. After an abrupt crash, replaying a few rejected
names uses already-saved domain records. Snapshot pages remain stable until
`--refresh`; there is no automatic expiry that silently changes page contents.

SQLite databases, WAL/SHM sidecars, old default JSON caches, and session folders
are gitignored. Use one checking process per cache/session: the limiter is shared
between workers in one process, not a cross-process request coordinator.

## Measured smoke comparison

On 12 November 2026, a six-domain live comparison (five registered domains and
one RDAP-not-found domain) produced identical statuses with these elapsed times:

| Run | Seconds | Network attempts |
| --- | ---: | ---: |
| Previous sequential JSON-cache implementation | 6.456 | 6 |
| Initial implementation, empty cache, 4 workers / cap 4 | 3.265 | 7 |
| New implementation, all six cached | 0.002 | 0 |

The extra new-client attempt was recovery from a stale reused connection, after
which connection reuse was disabled for that run. This is a small sequentially
conducted smoke comparison, not a rate-limit benchmark or a guarantee for a
large filtered search. There was no attempt to discover the service's maximum
quota by flooding it. Unit tests separately cover out-of-order completion,
lookahead bounds, retries, cache migration, cancellation, and ordered resumption.

## Cold-cache filtered measurements

The larger runs on 12 November 2026 used calm, length 6, seed 42, with registered
domains hidden. Each started with its own empty local cache and session. Runs
were sequential, on the same machine; registry-side caching and network variation
were not controlled.

| Configuration | Available names | Candidates checked | Seconds | HTTP attempts |
| --- | ---: | ---: | ---: | ---: |
| Initial concurrent implementation: 4 workers, cap 4 | 200 | 476 | 139.535 | 478 |
| Improved scheduling and TLS setup: 8 workers, cap 8 | 200 | 476 | 85.192 | 477 |
| Improved implementation: 8 workers, cap 12 | 200 | 476 | 73.603 | 478 |
| 8 workers, cap 20, start 2 | 200 | 476 | 67.622 | 477 |
| 8 workers, cap 20, start 2 | 1,000 | 2,236 | 165.598 | 2,237 |
| Final defaults: 8 workers, cap 20, start 4 | 200 | 476 | 41.474 | 477 |

All runs returned the same first 200 names in the same order. The final defaults
reduced the 200-result elapsed time by 70.3% versus the initial concurrent version
(3.36× faster); this comparison includes scheduling, TLS setup, and pacing changes.
The larger 1,000-result run used the earlier starting rate of 2. Both it and the
final 200-result run had zero cache hits, no HTTP 429 responses, and one
stale-connection retry each. In the larger run,
HTTP latency was 0.201 seconds median and 0.228 seconds at the 95th percentile.
Reading its five saved 200-result pages took 0.030 seconds with zero network
requests; all 1,000 names were unique and matched the original result order.

The default is now eight workers and a local ceiling of 20 attempts/second.
The original measurements above used a ceiling of 20, not a discovered provider
quota or a claim of maximum possible throughput. Later exploratory runs are
recorded below. The limiter starts at 4 and backs
off on throttling. These measurements cover up to 1,000 available names, **not
200 full pages**. A cold search must discover the required filtered prefix;
caching avoids that cost on subsequent visits.

## Repeating a cold-cache benchmark

Run the benchmark sequentially, with a new output directory each time:

```bash
python3 scripts/benchmark_lookup.py --workers 8 --rate 20 --count 200 --page 1 --out .cache/bench-200
python3 scripts/benchmark_lookup.py --workers 8 --rate 20 --count 1000 --page 1 --out .cache/bench-1000
```

Each run starts with an empty local domain cache and browsing session. It records
progress every ten seconds and saves timings, response counts, retries, and the
exact returned domain order in `result.json`. The normal cache is untouched.
Remote registry/intermediary caches cannot be cleared by this benchmark.

`--count 200 --page 200` means finding the first **40,000 available names** before
returning names 39,801–40,000. It is much more work than one page of 200 names.
Skipping the preceding checks would change the meaning of filtered pagination.
Use an unused output directory for every comparison; do not run competing
benchmark processes, because their rate limiters are independent.

## What limits throughput

The two CLI speed controls are `--lookup-rate` (one shared attempt budget per
second) and `--lookup-workers` (maximum simultaneous requests). They are separate:
a worker can be waiting for permission to send, waiting for an HTTP response, or
waiting to retry. A worker count of 16 does not mean 16 simultaneous requests are
always in flight.

A useful upper-bound estimate is:

```text
checks/second <= min(rate ceiling, workers / mean response seconds, provider capacity)
available names/second ≈ successful checks/second × availability yield
```

Real throughput is lower because of ramp-up, retries, ordered lookahead, variable
latency, checkpoint writes, and the final partially occupied window. Cache hits
avoid network work entirely. Hiding registered domains affects how many successful
checks are needed, not the underlying request rate. Page number affects how much
of the filtered prefix must already be known.

The current validation limits (16 workers and 20 attempts/second) are application
choices, **not measured Verisign quotas**. The starting rate (4), ramp (25% per 20
successes), lookahead (twice the workers), three-attempt retry limit, and 15-second
HTTP socket timeout are internal tuning constants, not additional CLI flags.

### Live concurrency sweep

A second set of sequential cold-cache runs on 12 November used 400 available
names per run (calm/6/seed-42), starting at 4 attempts/second and capped at 20:

| Workers | Seconds | Attempts/second after reaching ceiling | HTTP retries | Peak HTTP requests in flight |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 70.761 | 15.79 | 2 | 4 |
| 8 | 69.334 | 16.36 | 3 | 8 |
| 16 | 71.884 | 15.92 | 5 | 9 |

All three inspected the same 932 candidates, returned the same ordered 400 names,
had zero local cache hits, and received no HTTP 429 responses. Median HTTP latency
was approximately 201 ms; the 95th percentile was 228–231 ms. Retry counts include
one stale-connection recovery per run and ordinary connection resets.

The observed plateau is approximately 16 attempts/second after ramp-up under the
current 20/second ceiling. Increasing workers beyond four gave little benefit in
these runs; eight remains the default to leave room for slow responses. Sixteen
was not faster. These are single runs per configuration, not statistically
established differences between worker counts. The metric includes the tail from
the first request made at the ceiling through the last such request's completion.

This concurrency sweep **did not find Verisign's throttle or failure threshold**.
Those three runs stayed within the existing application ceiling. Later bounded
rate exploration is separate; 20 is not an established registry maximum.

### Bounded live rate exploration

The production CLI remains capped at 20 attempts/second. The benchmark has an
explicit `--experimental-rate` switch for bounded trials up to 80; it still ramps
from 4 and uses no more than 16 workers. Each trial uses its own empty local cache.
This switch does not change the production defaults or remove backoff.

The benchmark stops new dispatch immediately on HTTP 429, Retry-After, server
failures, or permanent HTTP errors. It also stops on more than two failed attempts
in the latest 100, or p95 HTTP latency above one second in three consecutive
non-overlapping 100-response windows. Already-running requests can finish and be
cached. A provider-requested cooldown is still persisted. Do not start another
trial to bypass a provider stop or cooldown.

Early exploratory runs used a stricter single-window latency stop and stopped
two 30/second trials during short spikes. Similar spikes existed in a 20/second
baseline, so those runs do not establish a 30/second provider limit. Subsequent
trials require sustained latency degradation as described above. Their results
must be interpreted with this methodology change in mind.

The live exploration on 12 November 2026 used 16 workers, calm/6/seed-42,
and separate empty caches. Completed 1,000-result runs each checked the same
2,236 candidate domains and returned identical names/order. Partial runs retained
the same ordered prefix; failures were not classified as available.

| Configured ceiling | Available results | Seconds | Attempts/sec after ramp-up | Retries | Outcome |
| ---: | ---: | ---: | ---: | ---: | --- |
| 25 | 1000 | 133.088 | 18.62 | 5 | Completed |
| 27.5 | 1000 | 109.641 | 23.69 | 5 | Completed |
| 30 | 330 | 49.500 | 21.65 | 2 | Stopped: early single-window latency guard |
| 30 | 641 | 73.048 | 26.63 | 2 | Stopped: early single-window latency guard |
| 40 | 1000 | 89.405 | 30.90 | 3 | Completed |
| 40 (confirmation) | 1000 | 85.182 | 32.99 | 1 | Completed |
| 50 | 1000 | 93.647 | 28.88 | 6 | Completed |
| 60 | 546 | 54.366 | 34.95 | 6 | Stopped: >2% failed attempts in latest 100 |

The best tested operating point was 40/second with 16 workers: two completed
1,000-result runs took 89.405 and 85.182 seconds. The confirmation run had no
ordinary connection resets, only the initial stale-connection retry, and no
100-response latency window exceeded one second. At 50/second it took 93.647 seconds and twice as many retries. Two consecutive
100-response windows at 50 had p95 latency of 2.62 and 3.37 seconds; performance
subsequently recovered. At 60, a burst of connection resets crossed the error guard
after 546 displayed results. The observed throughput gain before stopping was
small (34.95 attempts/second, versus 30.90 at 40).

No HTTP 429 was observed. These are bounds on useful performance in this
client/network test, not a proven registry quota. Connection resets and latency
spikes cannot be attributed conclusively to Verisign rather than the network or
an intermediary. Partial-run times are not comparable to full 1,000-result times.
The 25/second run also recovered a 15-second timeout, illustrating network variance.
A practical recommendation from these runs is a 40/second ceiling with 16
workers, delivering about 31–33 checks/second after ramp-up. Fifty completed but
was slower, and 60 crossed the exploratory error guard; this brackets a useful
operating limit for this setup, not a universal breaking point. Production
defaults and validation caps remain unchanged while exploring. To reproduce the
experimental setting with a new empty cache:

```bash
python3 scripts/benchmark_lookup.py --experimental-rate --workers 16 --rate 40 --count 1000 --out .cache/rate40-trial
```

### Controlled saturation and failure tests

Run the simulated-provider suite without contacting any public service:

```bash
python3 scripts/stress_lookup.py --out .cache/local-stress.json
```

Only this local simulation overrides the rate ceiling and starts directly at the
target rate, to isolate steady-load limits from ramp-up. It uses real worker
threads, pacing, retries, ordered consumption, and SQLite writes, with a fake
response function replacing HTTP. It does not measure real DNS, TLS, socket,
provider, or Internet behavior. It asserts result order, complete recovery on the
transient throttling case, and no successful cache entries on permanent failure.

With fixed 200 ms synthetic responses, eight workers delivered 37.3 checks/second
at a ceiling of 40 and 38.3 at a ceiling of 80. Doubling the rate barely helped:
the worker/latency limit was approximately 8 / 0.2 = 40 checks/second. Sixteen
workers delivered 68.0/second at a ceiling of 80 and 73.4 at 160, approaching their
80/second worker/latency limit. These are synthetic measurements only.

With a simulated 10-request/second quota, requesting 10/second completed 60 checks
in 6.075 seconds (9.88/second), without retries. Starting at 20/second caused two
429 responses and backoff: the same 60 checks took 12.489 seconds (4.80/second).
The limiter recovered and preserved all results, but overshooting halved useful
throughput. A simulated 403 stopped after one attempt with no cached results. A persistent
simulated 503 exhausted the first domain’s three attempts and stopped in 11.558
seconds (including shared backoff); five total attempts included speculative
checks. No results were emitted or cached, and no domain exceeded three attempts.

## Interpretation

“Possibly available” remains an absence of a registration record, not a registrar
purchase guarantee. Performance settings are separate from sound-design controls.
No provider credentials, IP rotation, rate-limit bypass, or changed sound rules
are needed.

Sources: [IANA RDAP bootstrap](https://data.iana.org/rdap/dns.json),
[RDAP routing example](https://rdap.org/domain/example.com).
