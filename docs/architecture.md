# Architecture

One root package builds the static web application and a Node CLI. The pure
engine has no DOM, filesystem, Node or network imports. Runtime adapters supply
pronunciation dictionary loading and durable stores.

| Boundary | Responsibility |
| --- | --- |
| `core/profile.ts` | Recipes, validated controls, blend/dial precedence; small UI import |
| `core/generator.ts` | Weighted sampling without replacement; cached structural transitions and removed-prefix tree |
| `core/random.ts` | Integer-seeded MT19937; fixed random sequence retained by golden fixtures |
| `core/pronunciation.ts`, `dictionary.ts` | Explicit readings, ARPABET, lazily decoded binary CMU dictionary |
| `core/inverter.ts`, `substitutions.ts` | Reverse reports, 1,331-point inverse grid and bounded substitution beam |
| `lookup/` | Strict RDAP/NS parsing, provider budgets, retries, ordering and storage contracts |
| `web/src/lookup/store.ts` | IndexedDB records, ordered matches and transactional checkpoints |
| `cli/store.ts` | SQLite WAL records/checkpoints; OS-released SQLite lock prevents concurrent CLI writers |
| `web/src/lookup.worker.ts` | Generation, search, cancellation and origin Web Lock |
| `web/src/analysis.worker.ts` | Off-main-thread fitting and dictionary analysis |

## Determinism and speed

Generation precomputes feasible transitions for each depth and remaining length.
A sparse prefix tree tracks consumed probability mass without rebuilding string
keys for every candidate. Compensated sums, subtraction order, PRNG calls and
spelling order remain identical to the frozen reference. Three 10,000-name
sequences cover accumulated drift; 58 shorter cases cover controls and seeds.
WASM was not needed: CPU profiling isolated avoidable TypeScript work.

`profile.ts` is separate so the entry bundle does not carry generation code or
sound inventories. Both checked and unchecked generation run in the lookup
worker. The UI's generation request IDs reject stale results. The static shell
is generated from `shell.ts` at build time; fonts activate after the initial
render frame. Analysis views load on demand.

## Lookup correctness

NS-positive exact-name answers may mark a domain registered. Negative, malformed,
truncated or failed DNS replies go to RDAP. Only validated RDAP 404s mark a name
possibly available. Errors never do. In-flight requests deduplicate by domain
and freshness boundary. Store writes finish before publishing results.

Browser defaults are six RDAP slots / 30 attempts per second, with 12 slots and
40 queries per second per DoH provider. Node defaults are 32 / 160 for RDAP and
32 / 160 per DoH provider. Rates ramp up; 429 and overload trigger persisted
cooldowns. Retry timers do not hold fetch slots. Correlated failures reduce rate
and concurrency; healthy replies recover them. Provider selection stays stable
by domain hash and never rotates to bypass a cooldown. Pending DNS can use an
otherwise idle RDAP slot after 250 ms; DNS-ready work takes priority.

The shared ordered search keeps at most 256 speculative candidates. Completion
signals release capacity behind a slow early candidate without adding repeated
Promise.race handlers. The committed cursor cannot pass unresolved earlier work.
Results may finish out of order, but pages always follow the seeded sequence.
Filtered session identity excludes page size and lookup tuning. Freshness is an
explicit snapshot until refresh; reopening saved pages makes no requests.

## Memory and lifecycle

Long feeds retain logical domain strings and result metadata, while recycling
100-row DOM blocks after 200 results. Ordinary 20/50/200-row feeds retain their
original DOM layout. Scroll-back reconstructs the same rows; focus retains its
block, and Tab/Shift-Tab mount the adjacent block before moving focus. CSV exports
all logical results. Starting another search releases non-shortlisted old rows.

CMU words and phoneme IDs remain in byte buffers with typed block offsets.
Binary search expands only a requested word's readings. All 126,052 words and
ordered alternatives are verified against an independently captured digest.

Hidden/offline documents pause fetches and save committed progress, then resume
when visible/online. The service worker caches only the same-origin shell and
used dictionary. It never performs RDAP/DoH work. Versioned updates wait for old
clients to close. IndexedDB/localStorage can be denied or evicted; errors surface
and Shortlist backup/import remains independent of cache clearing.

## Delivery and constraints

`npm run build` produces `web/dist/` and `dist/cli.mjs` plus `dist/cmudict.bin`.
The manually dispatched Pages workflow uses Node 24, runs the one test suite,
and uploads `web/dist/`. Runtime npm dependency count is zero. The CLI uses Node's
built-in SQLite, which can still emit an experimental warning on some releases.

No backwards import of Python JSON/SQLite/session formats is attempted. The
bundled dictionary is US English and may be inappropriate for a particular name.
Physical Safari suspension and cellular performance remain unverified. Feeds
bound DOM nodes, while logical rows and generator removed-prefix state still grow
with the explored search. Extremely late pages regenerate their deterministic
prefix; no constant-memory claim is made for an unlimited search.
