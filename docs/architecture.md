# Architecture

One root package builds the static web application and a Node CLI. The pure
engine has no DOM, filesystem, Node or network imports. Runtime adapters supply
pronunciation dictionary loading and durable stores.

| Boundary | Responsibility |
| --- | --- |
| `core/profile.ts` | Dial recipes, validated controls, blend/dial precedence; small UI import |
| `core/grammar.ts` | Spelling tokens by slot, run parsing, whole-word structure counts |
| `core/generator.ts` | Weighted proposals without replacement, then whole-word selection: mood fit, learned name prior, distilled judge readings |
| `core/constants.json`, `core/prior.json` | Hand-set sound table and mood character; data-built prior (regression weights, letter trigrams, teacher model) |
| `scripts/build-prior.ts`, `sample-registrations.ts`, `update-fixtures.ts`, `eval/` | Rebuild the prior from `data/`, extend its labels, refresh snapshots, run the blind evaluation loop |
| `core/random.ts` | Integer-seeded MT19937; fixed random sequence retained by golden fixtures |
| `core/pronunciation.ts`, `dictionary.ts` | Explicit readings, ARPABET, lazily decoded binary CMU dictionary |
| `core/inverter.ts`, `substitutions.ts` | Reverse reports, 1,331-point inverse grid and bounded substitution beam |
| `lookup/` | Strict RDAP/NS parsing, provider budgets, retries, ordering and storage contracts |
| `web/src/lookup/store.ts` | IndexedDB records, ordered matches and transactional checkpoints |
| `cli/store.ts` | SQLite WAL records/checkpoints; OS-released SQLite lock prevents concurrent CLI writers |
| `web/src/lookup.worker.ts` | Generation, search, cancellation and origin Web Lock |
| `web/src/analysis.worker.ts` | Off-main-thread fitting and dictionary analysis |

## Determinism and speed

Proposals cache feasible transitions for each slot and remaining letters and
syllables. A prefix tree tracks consumed probability mass so no spelling is
proposed twice; never-visited prefixes pick by binary search. Selection scores
rounds of 256 proposals and keeps the best few (see
[sound engine](sound-dials.md)). The sequence depends only on settings, seed
and engine data. `ENGINE_ID` fingerprints the constants and prior and keys saved
searches, so a retuned engine never mixes into old pages. Engine outputs are
regression snapshots (`scripts/update-fixtures.ts`): three 10,000-name
sequences and 58 shorter cases; the PRNG and pronunciation fixtures remain the
independently captured references. Behavioural tests cover constraints, dial
directions, blending and mood separability.

`profile.ts` is separate so the entry bundle does not carry generation code,
sound inventories, mood character or the prior. Both checked and unchecked generation run in the lookup
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
