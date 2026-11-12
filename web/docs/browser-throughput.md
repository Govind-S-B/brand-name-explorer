# Browser throughput spike — 12 November 2026

Measured in installed, headless Google Chrome using Playwright and the real
browser fetch/CORS/network stack. No proxy, security bypass, alternate RDAP
endpoint, credentials, zone file, or downloaded domain dataset was used. The
workload is the first 240 calm/6/seed-42 generated candidates (104 RDAP-available,
136 registered); DNS-only sweeps use the first 128 and RDAP sweeps the first 120.
Each fetch uses `cache: no-store`; CDP disables browser HTTP cache. Remote caches,
server state, TLS resumption, and Internet conditions are uncontrolled. These
finite sequential runs establish useful settings here, not provider quotas.

## Protocols and sustained RDAP

CORS worked for Verisign, Cloudflare JSON DoH, and Google JSON DoH. CDP recorded
Verisign HTTP/1.1 with a maximum **six overlapping on-wire requests**, even when
12 application requests were outstanding. Cloudflare normally negotiated HTTP/3;
Google used HTTP/2 or upgraded to HTTP/3. A second Chrome run with QUIC disabled
verified both DoH APIs over HTTP/2, with no CORS or HTTP errors.

| Profile | RDAP concurrency | Total checks/sec (120 checks) | Sustained checks/sec, latter half |
| --- | ---: | ---: | ---: |
| Desktop | 1 | 2.45 | 2.50 |
| Desktop | 6 | 12.80 | 11.79 |
| Desktop | 12 | 8.01 | 7.22 |
| Mobile emulation, slow 4G | 1 | 3.25 | 3.34 |
| Mobile emulation, slow 4G | 6 | 19.80 | 21.03 |
| Mobile emulation, slow 4G | 12 | 19.71 | 20.53 |

The subsequent 240-check RDAP-only baseline sustained **15.45/sec desktop** and
**20.71/sec mobile emulation**. The later follow-up reached 29/sec desktop but
14/sec mobile. That variation precludes interpreting the mobile runs as evidence
that cellular is faster. Mobile emulation uses iPhone-13 dimensions/touch/UA,
CDP 150 ms latency, 1.6 Mbps down / 750 kbps up and 4× CPU slowdown; it is Chrome,
not Safari or a physical iPhone. Increasing RDAP application concurrency beyond
six does not add on-wire connections and can increase queue latency.

The earlier Python CLI 1,000-result RDAP-only run used 32 workers and cap 160:
2,242 attempts / 23.969 s = 93.5 attempts/sec overall, 119.1/sec after ramp-up.
That is a different workload size and transport; it is comparison context, not a
controlled browser-versus-CLI causal test. Python's 32 useful sockets cannot be
carried into a normal browser fetch pool.

## DoH concurrency and latency

| Profile / provider | Concurrency | Queries/sec, 128 checks | Median / p95 |
| --- | ---: | ---: | ---: |
| Desktop / Cloudflare | 4 | 15.6 | 166 / 597 ms |
| Desktop / Cloudflare | 12 | 162.8 | 67 / 91 ms |
| Desktop / Cloudflare | 24 | 270.7 | 77 / 108 ms |
| Desktop / Cloudflare | 48 | 419.5 | 96 / 117 ms |
| Desktop / Google | 4 | 19.6 | 122 / 482 ms |
| Desktop / Google | 12 | 71.0 | 68 / 435 ms |
| Desktop / Google | 24 | 124.1 | 66 / 395 ms |
| Desktop / Google | 48 | 182.6 | 96 / 361 ms |
| Mobile / Cloudflare | 12 | 69.7 | 159 / 208 ms |
| Mobile / Cloudflare | 24 | 115.0 | 180 / 286 ms |
| Mobile / Cloudflare | 48 | 114.7 | 360 / 465 ms |
| Mobile / Google | 12 | 59.7 | 165 / 344 ms |
| Mobile / Google | 24 | 98.1 | 177 / 316 ms |
| Mobile / Google | 48 | 114.1 | 354 / 480 ms |

48 was the highest concurrency tested and useful on desktop; no global maximum
was found. Cloudflare plateaued at 24 on throttled mobile; Google improved modestly
at 48 while median latency doubled. Earlier rows also warmed remote caches, so
these are not independent cold-resolver estimates. HTTP/2-only 48-concurrency
runs achieved 409/sec Cloudflare and 128/sec Google desktop, versus 115/sec and
102/sec mobile. No HTTP 429 or Retry-After throttling appeared. DNS SERVFAIL and
some timeouts did appear; they must fall back to RDAP.

## Combined pipeline and idle-slot experiment

All rows below returned identical registration classifications and all 104
RDAP-confirmed available results, in original candidate order after collection.
The spike keeps independent DNS/RDAP pools; production adds durable commits,
ordered streaming, pacing, retries, and bounded lookahead.

| Mode, 240 candidates | Desktop | Mobile slow 4G | RDAP attempts desktop / mobile |
| --- | ---: | ---: | ---: |
| RDAP only, six slots | 16.012 s | 12.062 s | 240 / 240 |
| Cloudflare-gated, 24 DNS slots | 7.691 s | 6.580 s | 112 / 112 |
| Gated, 250 ms idle-slot hedge | 7.716 s | 6.143 s | 112 / 113 |
| Split DoH, 24 total slots | 7.717 s | 6.156 s | 112 / 113 |
| Split DoH, 250 ms hedge | 7.646 s | 6.189 s | 112 / 114 |

The spike split provider assignment with a shared 24-slot DNS pool; slower replies
could occupy more than 12 of those slots. The production engine instead enforces
12 slots per provider, with independent pacing and cooldowns.

The DNS pre-filter avoided 126–128 RDAP requests and roughly halved elapsed time
in this small browser workload. Splitting across providers did not materially
improve desktop time; it modestly improved this mobile trial. It provides two
independent DNS budgets and avoids putting all recursive latency on one provider.
No claim of fault-independent capacity or a reason to bypass cooldowns is made.

A follow-up process compared a 500 ms DoH deadline and immediately filling idle
RDAP slots while DNS remained pending. Desktop: ordinary gating 5.714 s / 112 RDAP
calls; split + 500 ms deadline 4.105 s / 114 calls; split + immediate idle fill
4.074 s / 116 calls (six hedges). Mobile: ordinary gating 9.466 s / 112 calls; split + 500 ms deadline
8.845 s / 119 calls; immediate idle fill 8.567 s / 116 calls (six hedges).
These modes trade a few extra RDAP calls for shorter DNS tails. They were run
sequentially, with uncontrolled remote caches; the difference is observed, not a
statistically established optimization gain. A 500 ms deadline timed out nine
mobile DoH queries, so production uses a more forgiving two-second DoH deadline.

## Design decisions for the port

- Cap RDAP at **six active fetches**, with a default adaptive budget of 30/sec,
  starting at eight. Raising worker counts to 32/64 is moot in the browser.
- Use **12 DoH slots per provider**, separate adaptive 40/sec budgets, deterministic
  provider assignment, and no same-name provider racing. This feeds six RDAP
  slots without requiring 48–96 DNS requests in flight on a phone.
- Normally gate on NS evidence. After **250 ms**, pending DNS may send RDAP only
  if an RDAP slot is idle and no DNS-completed RDAP work is waiting. Keep a two
  second DoH deadline; errors/negative answers go to RDAP. Once RDAP starts, do
  not let a late DNS positive override a conflicting RDAP result.
- Preserve strict RDAP confirmation, in-flight deduplication, stable order,
  bounded lookahead, retry timers outside slots, congestion backoff, shared
  provider cooldowns, and commit-before-publication. These carry over directly.
- Replace SQLite with IndexedDB transactions. Persist individual completions,
  freshness boundaries, session cursors, and matches. Resume after visibility
  return; never assume a service worker or iOS background tab can keep searching.
- Browser fetch owns TLS pooling, host DNS caching, address choice, and reconnection.
  Python's shared SSL context, custom address ranking, stale-socket exception
  special case, and thread-pool tuning are moot. Fetch exposes fewer transport
  failure details and Retry-After is readable only when CORS exposes the header;
  apply conservative backoff when it is unavailable.
- Keep generation independent of network; use a separate analysis worker for
  grid fitting/substitution beam search so it cannot starve lookup or the UI.
  Store selected names separately and support JSON export/import: browser storage
  can be denied or evicted even after requesting persistence.

## Reproduce and evidence

```bash
cd web
npm ci
npm run dev -- --port 5173
# In another terminal, from web/, sequentially:
npm run benchmark:browser
node scripts/browser-h2.mjs
node scripts/browser-throughput.mjs --followup
```

Set `CHROME_PATH` for another installed Chrome executable (the HTTP/2 runner uses
the macOS path directly). Checked-in aggregate timing, status, protocol and overlap evidence is in
`browser-throughput-summary.json`, `browser-h2-results.json`, and
`browser-throughput-followup-summary.json`. The runners also write full
per-request traces locally; those large artifacts are gitignored. No HTTP pressure was observed; runners stop
on HTTP 429/403/503 rather than trying other providers to evade a limit.
