# Measured performance — 12 November 2026

Same macOS machine, installed Chrome and Node 25.6.1. The pre-migration reference
is commit `73267ef38616f3b06da211973476f32b40a62478`. Run commands are in
[verification.md](verification.md). Full local traces, screenshot baselines and
heap snapshots live outside the source tree at `/private/tmp/bne-migration/`.
Values below are measured unless explicitly described otherwise.

## Shipped bytes and load

| Metric | Before | After |
| --- | ---: | ---: |
| Entry JavaScript, gzip | 10,164 B | 7,751 B |
| All JavaScript including workers/lazy UI, gzip | 30,207 B | 27,508 B |
| CSS, gzip | 6,238 B | 6,238 B |
| Three WOFF2 font subsets | 19,392 B | 19,392 B |
| HTML, gzip | 4,550 B | 4,529 B |
| Dictionary, raw | 2,320,867 B | 1,727,152 B |
| Dictionary, gzip | 816,962 B | 781,317 B |
| CLI program, raw (dictionary separate) | Python multi-file runtime | 40,798 B |

Tracked source-tree payload fell from 16.09 MB to 2.57 MB (84% smaller); old
Git history is deliberately preserved and is not included in that comparison.

The complete Node distribution is the CLI program plus the dictionary. It is
JavaScript for an installed Node runtime, not a standalone native executable.
The browser has zero runtime npm dependencies. Fonts and CSS are preserved for
visual parity. Shared worker generation and separating small profile controls
from generation keep the entry small; the generated HTML preloads the lookup
worker so unchecked generation does not add a serial fetch.

| Local load / Lighthouse metric | Before | After |
| --- | ---: | ---: |
| Cold usable names, slow 4G / 4x CPU | 511 ms | 535 ms |
| Cold observed LCP / observed TBT | 428 ms / 0 | 468 ms / 0 |
| Repeat usable / server payload | 98 ms / 866 B | 106 ms / 866 B |
| Offline usable / server payload | 86 ms / 0 B | 86 ms / 0 B |
| Cold installed-shell compressed bodies | 69,163 B | 66,415 B |
| Lighthouse mobile LCP / TBT | 753 ms / 0 | 754 ms / 0 |
| Lighthouse performance / accessibility | 100 / 100 | 100 / 100 |
| Lighthouse audited transfer, including lookups | 62,152 B | 68,581 B |

Direct load and Lighthouse are different measurement methods. The load harness
turns checks off and counts server response bodies including worker/service-worker
traffic. Lighthouse runs the default live lookup feed; its transfer includes
variable cross-origin responses and sees more worker traffic after preloading.
The entire installed shell is smaller even though this audit's transfer is larger.

The initial worker migration produced 778 ms cold usable time. Preloading the
worker removed the serial fetch dependency: 537 ms and 535 ms in the next two
runs, versus 511 ms baseline. Cold unchecked generation is about 24 ms slower in
this final single sample; repeat/offline times are essentially unchanged. We do
not claim an improvement in first-usable wall time or a statistically established
regression from these individual local observations.

## Generation, fitting and pronunciation

Five warmed samples per workload; table uses the median. Exact inputs and timing
code are `web/scripts/benchmark-core.ts`. Node GC is explicit for the dictionary
memory measurement. CPU profiles identified repeated structural partition calls,
string prefix keys and per-candidate allocations as the generation hot path.

| CPU workload | Before | After |
| --- | ---: | ---: |
| Generate 200 names | 4.03 ms / 49,659 names/s | 1.47 ms / 136,464 names/s |
| Generate 4,000 names | 71.37 ms / 56,042 names/s | 12.76 ms / 313,432 names/s |
| Generate 10,000 names | 176.03 ms / 56,807 names/s | 20.34 ms / 491,535 names/s |
| Exact inverter, 1,331 dial points | 61.74 ms | 28.21 ms |
| Install dictionary (read + parse + GC) | 86.28 ms | 2.82 ms |
| 10,000 repeated pronunciation requests | 16.55 ms | 54.46 ms |
| Node dictionary retained allocation | ~31.77 MB V8 heap | ~1.76 MB byte buffers, negligible added V8 heap |

The same minified engines also ran in Chrome 156.0.8078.48, five warmed samples,
without network or CPU throttling (`web/scripts/benchmark-generation.mjs`):

| Browser CPU workload | Before | After |
| --- | ---: | ---: |
| 200 names | 4.6 ms / 43,478 names/s | 1.2 ms / 166,667 names/s |
| 4,000 names | 63.7 ms / 62,794 names/s | 8.4 ms / 476,190 names/s |
| 10,000 names | 158.7 ms / 63,012 names/s | 16.5 ms / 606,061 names/s |

The compact dictionary deliberately trades a few microseconds per lookup for a
much smaller retained representation. It does not expand 126,052 word/reading
object trees. Every word and alternate reading has exact digest parity. No WASM
was adopted: the measured TypeScript optimizations already remove the hot work
and avoid adding a module, initialization path or second implementation.

## Cold real-network lookup

Fresh local caches / fresh browser contexts; calm, six letters, seed 42, filtered
available names. Remote resolver/registry caches, DNS answers, network latency
and TLS state are uncontrolled. Runs are sequential observations, not provider
quotas or causal estimates. Every displayed name was RDAP-confirmed; both new
runtimes returned exactly the same ordered names as their fresh baseline runs.
Candidate counts were 476 for 200 matches and 8,749 for 4,000.
The final saved 200-name CLI page reopened in 4.97 ms with zero RDAP/DoH calls.

| Runtime / available results | Before seconds | After seconds | Candidate checks/s before → after | RDAP attempts before → after |
| --- | ---: | ---: | ---: | ---: |
| CLI, 200 | 17.956 | 7.969 | 26.5 → 59.7 | 218 → 246 |
| CLI, 4,000 | 94.015 | 73.079 | 93.1 → 119.7 | 4,328 → 4,961 |
| Browser, 200 | 15.627 | 15.134 | 30.5 → 31.5 | 223 → 221 |
| Browser, 4,000 | 226.786 | 191.705 | 38.6 → 45.6 | 4,333 → 4,328 |

RDAP attempt throughput (whole run, including ramp-up and other work) was
12.1 → 30.9/s for CLI 200; 46.0 → 67.9/s for CLI 4,000;
14.3 → 14.6/s for browser 200; 19.1 → 22.6/s for browser 4,000.
Browser transport still has the six HTTP/1.1 connection ceiling. The new CLI
also beats the previously supplied historical targets of about 10.7–11 seconds
for 200 and 95 seconds for 4,000, although those older runs are not controlled
contemporaneous comparisons.

DoH queries remained 476 / 8,749. The new Node runtime's earlier 32/sec RDAP ramp
and idle-slot hedging use more requests while cutting elapsed time: 766 hedges,
25 retries and 165 DNS errors falling back in the 4,000 run. DNS avoided 3,813
RDAP calls there, versus 4,445 in Python; browser DNS avoided 4,421 versus 4,416.
An earlier implementation run measured 10.421/73.905 seconds for Node 200/4,000.
The final repeat above aligns both DoH ramp-up rates at 32/sec. Faster 200-name
time may also reflect uncontrolled remote caches/network conditions.
No provider throttles were observed in these final runs. The user can disable
DNS, but negative DNS replies must still go to RDAP. Errors remain unknown.

The same portable search now also removes repeated Promise.race subscriptions,
bounds speculation at 256 candidates and avoids growing result DOM with the
number of rows. The observed browser improvement includes runtime/network noise;
it cannot be attributed entirely to the UI or scheduler changes.

## Memory

CDP `HeapProfiler.collectGarbage` followed by `Runtime.getHeapUsage` for the main
page and each dedicated worker. Final captures additionally save CDP heap
snapshots. Counters distinguish V8 heap, byte-buffer backing storage and Blink
embedder heap. This is not process RSS or a physical iPhone measurement. The
workload has checks off, loads Reverse's dictionary, then generates 4,000 and
8,000 names; both phases use the same harness.

| Heap at workload checkpoint (decimal MB) | Before | After |
| --- | ---: | ---: |
| Landing main V8 | 2.21 | 2.14 |
| Landing lookup-worker V8 | 0.305 | 0.387 |
| Dictionary-loaded analysis-worker V8 | 15.21 | 0.485 |
| Analysis-worker backing storage | 0.022 | 1.780 |
| 4,000 names: main V8 / embedder | 3.21 / 124.22 | 2.63 / 4.97 |
| 8,000 names: main V8 / embedder | 3.97 / 269.80 | 2.89 / 8.29 |
| 8,000 names: lookup-worker V8 | 0.305 | 0.397 |
| 8,000 names: rendered rows | 8,000 | 200 |

All final worker/page snapshots were saved. The before counters used the same
forced-GC harness without snapshot export; snapshot collection adds more GC work,
so small differences should not be overinterpreted. The dictionary reduction is
about 85% including its byte buffers. The large-feed embedder reduction is about
97%; the dominant difference is the row population, not a V8 heap-size claim.
The separate long-feed verifier observed 100 rendered rows after scrolling back.
Keyboard cross-block navigation, scroll-back and all 8,000 exported rows passed.
Logical domain strings/result metadata and removed generator prefixes still grow
with search length; only the costly DOM row population is bounded.

## UI-library evaluation

A bundled, minified interactive Save counter with each library, built using the
same esbuild and gzip settings: Preact 11.2.0, Solid 1.9.19, Lit 3.3.3,
VanJS 1.6.2 and petite-vue 0.4.1. These are measured representative spikes, not a
claim that a complete rewrite has been implemented or benchmarked.

| Implementation | Raw JS | Gzip JS |
| --- | ---: | ---: |
| Vanilla | 129 B | 125 B |
| VanJS | 2,441 B | 1,229 B |
| Solid | 11,293 B | 4,474 B |
| Preact + hooks | 13,146 B | 5,571 B |
| Lit | 15,351 B | 5,868 B |
| petite-vue | 16,708 B | 7,266 B |

Keep vanilla. Even the smallest spike adds about 1.1 KB before integrating our
existing static shell, dialogs, asynchronous workers, storage and lifecycle.
Those concerns remain regardless of render library. There is no demonstrated
net reduction in shipped bytes or complexity, and replacing the UI would add
visual/behavioral risk. A complete framework rewrite's runtime and memory are
**unmeasured**, so no performance superiority is claimed for hypothetical ports.

## Interpretation and next measurements

The largest established local wins are generation CPU, dictionary retained
memory, DOM population and entry transfer. Browser/CLI public-service timings
vary substantially between runs; rerun an isolated 200/4,000 comparison after
provider or transport changes. Do not raise browser concurrency beyond six.
For future product work, test Safari on physical hardware and very late pages;
keep the already liked v2 design locked until new user feedback.

## Shared name rows and modal follow-up (2026-11-13)

Compared the published heading-chip version (`887e82d`) with the shared-name
implementation using the same gzip settings and CDP forced-GC memory harness.
The before page was served from Pages and the after page from the local production
preview; both used fresh Chrome contexts, the same 390 px viewport, and no domain
checks for heap measurements. These are single heap observations, not device RSS
or a claim of a speed improvement. Browser tests separately use real providers.

| Metric | Before | After |
| --- | ---: | ---: |
| Entry JS gzip | 7,727 B | 8,920 B |
| CSS gzip | 6,244 B | 6,246 B |
| Landing main V8 heap | 2.142 MB | 2.160 MB |
| 8,000-name main V8 heap | 2.941 MB | 2.946 MB |
| Analysis-worker V8 + backing storage | 2.265 MB | 2.266 MB |
| 8,000-name rendered rows at heap checkpoint | 200 | 200 |

The additional UI bytes cover shared reference names, modal Back/focus state and
request routing. No runtime dependency, generation change, lookup-engine change
or initial dictionary download was added. The separate feed verifier observed
100 rendered rows after scroll-back, 8,000 distinct CSV rows and zero axe issues.
The 22-hop modal test verified the 20-view history bound. Embedder-heap counters
varied with rendering timing (13.51 → 8.15 MB at 8,000 names); that variation is
not treated as an optimization result.

Raw observations are under `/private/tmp/bne-affordances-*`; the shared-name
screenshots are under `/private/tmp/bne-name-affordances/`.

Follow-up mobile Lighthouse on the local production build: performance 100,
accessibility 100, LCP 752.6 ms and TBT 0. This is one run, not a new network
throughput benchmark; generation and lookup algorithms are unchanged.

## Inline domain checking (2026-11-13)

Compared with the shared-name version (`f2e551b`), using the same production
build/gzip and 390 px CDP forced-GC harness. Before values are the recorded
shared-name measurements above. After values below are single local observations;
they are not physical-phone memory measurements or statistical speed claims.

| Metric | Before | After |
| --- | ---: | ---: |
| Entry JS gzip | 8,920 B | 9,563 B |
| CSS gzip | 6,246 B | 6,283 B |
| Landing main V8 heap | 2.160 MB | 2.176 MB |
| Landing lookup-worker V8 heap | 0.387 MB | 0.389 MB |
| 8,000-name main V8 heap | 2.946 MB | 2.847 MB |
| 8,000-name lookup-worker V8 heap | 0.397 MB | 0.399 MB |
| Analysis-worker V8 + backing storage | 2.266 MB | 2.266 MB |
| Rendered rows at 8,000-name checkpoint | 200 | 100 |
| Mobile Lighthouse performance / accessibility | 100 / 100 | 100 / 100 |
| Mobile Lighthouse LCP / TBT | 752.6 ms / 0 | 752.9 ms / 0 |

The explicit check shares existing DNS/RDAP gates and takes the next available
slot ahead of queued feed jobs. The 390 px controlled test confirms an outstanding
manual check survives feed completion and is rescheduled after pause/change;
the feed's RDAP counter remains 20 for its 20 calls, excluding the manual call.
Tests verify cached modal reopening makes zero network calls and repeated clicks
make one request. No generation/provider-validation algorithm, provider limit,
font, dictionary or runtime dependency changed. Public-service 200/4,000 timings
were not rebenchmarked for this UI follow-up; no throughput improvement is claimed.

The final memory checkpoint retained 100 rendered rows rather than the baseline's
200 because viewport recycling settled differently. Earlier after-build samples
with 200 rendered rows measured 3.055–3.078 MB at 8,000 names. These observations
establish bounded rows, not a memory improvement. Raw evidence:
`/private/tmp/bne-inline-memory.json`, `/private/tmp/bne-inline-lighthouse.json`
and `/private/tmp/bne-inline-check/`.

## Automatic discovery-list checks (2026-11-13)

Compared with `65fc26a` using the same production build and mobile Lighthouse
harness. Each Lighthouse value is one local observation; there is no speed claim.

| Metric | Before | After |
| --- | ---: | ---: |
| Entry JS gzip | 9,563 B | 9,797 B |
| All JS gzip | 30,427 B | 30,678 B |
| CSS gzip | 6,283 B | 6,283 B |
| Lighthouse performance / accessibility | 100 / 100 | 100 / 100 |
| Lighthouse LCP / TBT | 752.9 ms / 0 | 753.2 ms / 0 |

Nearby, Reverse references/samples and displayed Shortlist lists now start domain
checks automatically. Controlled tests confirm recent-cache reopening and repeated
results make no additional requests, expired domain/DNS cache rechecks, duplicate
names share a check, and hidden startup Shortlist/hidden Reverse results make no
requests. Five-minute cache reuse applies to automatic discovery checks; explicit
refresh still bypasses old evidence. Explore's preference and limits are unchanged.
No generation, dictionary, font, CSS or runtime dependency change. Heap and
200/4,000-name throughput were not remeasured for this UI trigger change.
Evidence: `/private/tmp/bne-auto-lighthouse.json` and the updated
`/private/tmp/bne-inline-check/` screenshots.
