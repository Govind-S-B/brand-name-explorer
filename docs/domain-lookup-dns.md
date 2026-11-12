# DNS pre-filter: behavior and measured results

The live NS pre-filter reduced the 4,000-result cold-cache search from **133.506
to 95.226 seconds (28.7%)**, skipping **4,443 RDAP checks**. It did not consistently
improve short-page elapsed time. Available names remain RDAP-confirmed.

## Implementation

For each name without a sufficiently fresh domain record:

1. Read its unexpired DNS evidence, or query Cloudflare's
   `https://cloudflare-dns.com/dns-query?name=NAME.com&type=NS` with
   `Accept: application/dns-json`.
2. A successful response must contain a matching NS question and an exact-name
   type-2 NS answer in the answer section. Parent authority records and CNAMEs
   do not qualify. Record registration and skip RDAP.
3. NXDOMAIN, no NS, DNS errors, malformed/mismatched/truncated answers, and resolver
   exceptions fall through to the existing RDAP path. Only validated RDAP 404s
   produce `possibly available`; DNS never produces availability.

DNS has a separate 32-worker pool and adaptive limiter (start 16, ceiling 160
queries/second). It shares the completion dispatcher and SQLite transaction
boundary, but no worker slots, request budget, or provider cooldown with RDAP.
DNS performs one attempt per name; failures use RDAP rather than holding up the
page with DNS retries. HTTP 429/Retry-After persists a DNS-only cooldown; queued
DNS work falls through to RDAP during it. Active DNS calls may still finish.
These application ceilings are not discovered provider quotas.

`DomainLookup(..., resolver=resolver)` accepts a small interface:
`get(domain) -> DnsResult(outcome, ttl, error, throttled, retry_after)` and `close()`.
Outcomes are `ns`, `nxdomain`, `no_ns`, or `error`. The default `DohResolver`
uses the existing verified HTTPS transport. A replacement need only implement
this interface; transport host address caching remains separate per client.
`dns_workers` and `dns_rate` are independent constructor controls; `dns=False`
supports the comparison runner. No runtime dependency or downloaded dataset was
added. A future browser implementation can use the JSON DoH API; browser CORS
behavior and a browser port were not tested here.

The existing SQLite database gets a `dns` table containing outcome, check time,
and expiration. NS evidence uses the minimum answer TTL, capped at one day;
negative evidence uses SOA TTL/minimum, capped at 300 seconds. Errors are not
cached as DNS outcomes. Unexpired evidence can resume a DNS-completed/RDAP-pending
check. `--refresh` requires both DNS and domain evidence after its freshness
boundary. Final domain records and saved sessions retain their existing snapshot
semantics until refresh; DNS TTL expiration does not silently change saved pages.
Both DNS evidence and resulting registration are committed before publishing a
successful result. Ordered consumption, bounded lookahead, and page coverage
are preserved.

## Live comparisons on 12 November 2026

All runs were sequential on this machine, using calm/length-6/seed-42, registered
names hidden, 32 RDAP workers/cap 160, and separate empty local caches and
sessions. Remote resolver, registry, and intermediary caches were not controlled.
Before/after 200 and 4,000 used a saved copy of the original source for the
baseline; 1,000 and repeated 200 used the updated engine's `--no-dns` path.

| Available results | Time before → after | RDAP attempts before → after | Distinct RDAP checks skipped | DoH queries | DoH median / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 200, first pair | 11.375 → 22.966 s | 481 → 217 | 261 | 476 | 150 / 1,183 ms |
| 4,000 | 133.506 → 95.226 s | 8,891 → 4,313 | 4,443 | 8,753 | 127 / 945 ms |
| 1,000 | 23.969 → 24.294 s | 2,242 → 1,069 | 1,169 | 2,236 | 35 / 538 ms |
| 200, repeat pair | 10.782 → 11.019 s | 478 → 216 | 261 | 476 | 32 / 504 ms |

RDAP attempts include retries. Distinct skipped checks count NS-positive names;
the attempt reduction also includes fewer retries. The 4,000-result case saved
4,578 actual RDAP attempts (51.5%), comprising 4,443 skipped names plus 135 fewer
retries. It still made more total HTTP requests: 8,753 DoH + 4,313 RDAP = 13,066,
versus 8,891 RDAP-only requests. The observed gain is fewer RDAP requests and
less RDAP recovery time, not fewer total requests.

| Run | RDAP retries before → after | DNS failures falling back | Stalls / errors |
| --- | ---: | ---: | --- |
| 200, first | 5 → 2 | 6 unusable replies | After: one 5 s RDAP timeout; slowest DNS 4.619 s |
| 4,000 | 138 → 3 | 130 unusable replies + 30 timeouts | Before: 125 RDAP timeouts, 12 resets, one stale connection, six congestion reductions. After: two RDAP resets, one stale connection, zero RDAP timeouts or congestion reductions; 414 DNS calls >1 s, slowest 5.005 s |
| 1,000 | 6 → 2 | 27 unusable replies + 2 timeouts | After: one RDAP reset, one stale connection; slowest DNS 5.003 s |
| 200, repeat | 2 → 1 | 6 unusable replies | After: one stale RDAP connection; no RDAP timeout |

No RDAP or DoH HTTP 429 was observed, and no DoH cooldown was triggered in these
trials. This does not establish an absence of provider throttling at other loads.
Unusable replies were logged as `unexpected DNS response`; their exact server
RCODE/cause was not retained, so they cannot be attributed to throttling.
The first sandboxed attempt could not resolve the endpoint and was interrupted;
it is excluded. All tabulated runs had working network access, zero domain-cache
hits, and completed without unresolved errors.

The first 200-result trial's timeout and slow DNS tails account for its poorer
timing. The repeat had a fresh local cache, but faster DoH latency may reflect
remote caching or network variation; causality was not isolated. These are
individual trials, not statistical performance estimates. The earlier historical
4,000-result notes recorded 8,752 candidates; this fresh run needed 8,753. Both
new paths agreed exactly on the new candidate set, statuses, and result order.

## Correctness and local regression checks

- A reproducible random sample of **200 out of 4,443 DNS NS-positive names**
  (Python `random.Random(20261112).sample` on the sorted population) was checked
  with fresh RDAP queries and an empty independent cache, with DNS disabled:
  **200 registered, zero mismatches**, 201 RDAP attempts including one retry,
  7.021 seconds. This is a sample check, not a proof about all future DNS answers.
- Additionally, all 8,753 candidate statuses, including all 4,443 DNS positives,
  matched the earlier live RDAP-only baseline. The 200- and 1,000-result cases
  also matched their full candidate sets and exact returned order.
- DNS returned NXDOMAIN for **93 RDAP-registered names**, including `ramami.com`,
  `rutama.com`, `wolalo.com`, `nuwelu.com`, and `broomu.com`. Another 57 registered
  names had no NS. All 4,000 available results had NXDOMAIN followed by validated
  RDAP confirmation. These observations demonstrate why negatives must reach RDAP.
- All 20 saved pages reopened as 4,000 unique names in identical order in 0.044 s,
  with **zero RDAP and zero DoH calls**.
- **79 unit tests passed**, covering NS parsing, positive skips, negative/error
  fallback, separate worker pools/cooldowns, DNS cache expiry/refresh, resolver
  exceptions, commit-before-publication, and the existing ordering/recovery tests.
- The documented synthetic cache benchmark took 0.222 s to build page 20 from
  8,000 candidates and 0.705 s to build page 200 from 80,000; saved pages took
  0.0013 and 0.0052 s. The simulated retry benchmark completed 600 names/660
  attempts in 3.152 s. The full simulated stress suite also passed: its quota
  case recovered two 429s, and 403/503 failures published no successful records.
  These local tests used synthetic responses; they do not measure public services.

Machine-readable summaries, the exact 200-name verification sample, the negative
registered list, and local checks are preserved in
[domain-lookup-dns-results.json](domain-lookup-dns-results.json). Raw request
timings and exact output order remain in the local `.cache/doh-*-live/result.json`
artifacts (gitignored). The saved original source is in `.cache/doh-baseline-source/`.

## Reproduce

Run each command sequentially and choose unused output directories. The benchmark
refuses existing directories and never reads the normal user cache.

```bash
python3 scripts/benchmark_lookup.py --no-dns --count 200 --out .cache/rdap-200-new
python3 scripts/benchmark_lookup.py --count 200 --out .cache/doh-200-new
python3 scripts/benchmark_lookup.py --no-dns --count 4000 --out .cache/rdap-4000-new
python3 scripts/benchmark_lookup.py --count 4000 --out .cache/doh-4000-new
python3 scripts/benchmark_lookup.py --no-dns --count 1000 --out .cache/rdap-1000-new
python3 scripts/benchmark_lookup.py --count 1000 --out .cache/doh-1000-new
python3 scripts/verify_dns.py --benchmark .cache/doh-4000-new --out .cache/doh-verify-new
python3 -m unittest discover -s tests
python3 scripts/benchmark_cache.py
python3 scripts/benchmark_retries.py
python3 scripts/stress_lookup.py --out .cache/doh-stress-new.json
```

Live commands need outbound HTTPS to `rdap.verisign.com` and `cloudflare-dns.com`.
`result.json` separates `doh_queries`, `doh_samples`, latency percentiles, DNS
errors/throttles, and skipped RDAP checks from RDAP attempts/retries. The older
`dns_queries` metric means transport hostname resolution, not NS pre-filter calls.
`verify_dns.py` requires at least 200 positives and exits nonzero on a mismatch,
incomplete confirmation, or lookup error. It writes the sampled domains/results.

Recommended next experiment: compare a shorter DoH timeout or another resolver
at these same workloads. The current default reduces long-run RDAP stalls, but
DNS tail latency can offset the savings for short pages. No higher-rate sweep
was repeated; the existing default budgets and RDAP recovery policy were retained.
