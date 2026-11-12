# Lean TypeScript migration

Status: implemented and locally verified; publication verification follows. Branch: `lean-refactor`.

## Contract and architecture

Preserve the v2 interface and interaction model at 360, 390 and 1440 px. The
only planned visible removal is Original engine/style controls in Advanced.
Availability always requires a validated RDAP response; DNS can reject a name,
never declare it available. Preserve deterministic seeded ordering, durable
cache/session progress, shortlist data, accessibility and offline generation.

One root npm package, TypeScript build and Node test runner. `core/` owns pure
generation, pronunciation, inversion and substitutions. `lookup/` owns portable
providers and scheduling, depending on a storage interface. `cli/` supplies Node
arguments, file/SQLite storage, network settings and dictionary loading. `web/`
retains the static HTML shell, vanilla views, workers and IndexedDB adapter.
Runtime defaults are explicit: six browser RDAP connections; independently
measured Node concurrency. No WASM or UI framework without measured benefit.

## Legacy inventory to remove

- Original styles (`calm`, `flowing`, `expansive`), LegacySpace, preset constants,
  style flags, style UI and legacy-only fixtures/tests.
- Preference migrations or compatibility aliases, if found; retain current v2
  preferences and shortlist storage because these are active user data.
- All Python source, tests, benchmark/asset scripts and CI setup, after capturing
  independent golden fixtures and dictionary provenance.
- Duplicate Python/TypeScript algorithm definitions and runtime-specific logic
  embedded in the portable engine.
- Superseded UI captures, design references, full benchmark traces, port/history
  docs and stale commands. Preserve concise current docs and reproducible tools.
- Dead branches, flags and shims identified through caller searches and tests.

Keep reverse finding, exact fit, substitutions, explicit readings, integer-seed
compatibility, pagination, lookup tuning, cache management and backup/export.
These are current capabilities. Record any uncertain removal separately.

## Measurement plan

Capture every scripted UI state at all three sizes before code changes, outside
the source tree. Freeze freshly generated Python outputs for moods/seeds/dials,
reverse/inverter/substitutions, direct pronunciation and PRNG sequences, with
source hashes. Run both original suites before removing anything.

Use the same harness before/after, sequentially for timings:

- Build raw/gzip JS, CSS, HTML, fonts and dictionary sizes.
- Production preview cold/repeat/offline load with installed Chrome, slow 4G and
  4x CPU; Lighthouse mobile performance/accessibility, LCP, TBT and transfer.
- CDP main/lookup/analysis heap measurements after GC, including dictionary load
  and long feeds; report collection method and limitations.
- Repeated generation/analysis timings and CPU profiling with fixed inputs.
- Cold empty-cache live 200/4,000 available-name searches for CLI and browser;
  report elapsed time, candidate checks, RDAP/DoH attempts and errors. Respect
  provider cooldowns and distinguish local cold cache from remote cache state.
- Pixel comparisons for stable states; inspect timing-dependent states visually.
  Browser functionality, recovery, ordering, offline and axe checks.

## Execution sequence and commit boundaries

1. Plan, baseline screenshots, independent golden fixtures and measurements.
2. Move existing TypeScript into shared boundaries and consolidate build/tests;
   remove original engine and other confirmed legacy paths.
3. Build Node CLI with useful original defaults/options, durable storage,
   cancellation and runtime-specific lookup configuration. Verify cold throughput.
4. Optimize measured hot paths, dictionary representation and feed memory; keep
   goldens and the UI contract green after each change.
5. Retire Python and obsolete artifacts; rewrite architecture/usage docs and
   performance tables. Compare lean UI-library costs and record decision.
6. Re-run correctness, accessibility, visual and performance verification. Publish
   four v2 README images as GitHub Release assets. Review final diff.
7. Commit, merge to main without rewriting history, push and manually dispatch
   Pages. Wait for success and verify real lookups and 390 px UI on the live URL.

## Completion evidence

`docs/performance.md` will separate measured results, historical supplied numbers
and inference. Record full removals, uncertain retained items, UI differences,
test counts, release asset URLs, deploy run and remaining verification limits.

## Executed changes and full removal inventory

- Deleted `name_generator.py`, `domain_lookup.py`, `sound_engine.py`,
  `sound_profiles.py`, `pronunciation.py`, `reverse_finder.py`, `inverter.py`,
  `substitutions.py`; all five `tests/test_*.py` files; all five Python benchmark/
  stress/verification scripts; `web/scripts/fixtures.py` and `fonts.py`.
- Removed Original calm/flowing/expansive presets, LegacySpace, permutation and
  swap-map generation, `--style`, `--list-variants`, `--exclude-registered` alias,
  the Advanced Engine selector, style-dependent length limits and disabled mood
  controls, and 27 Original-only parity cases. Calm **mood** remains a core recipe.
- Removed JSON-to-SQLite cache import, legacy progress import, sibling session
  directory compatibility, old HTTP socket/SSL/address-selection plumbing,
  thread pools and Python's duplicate algorithms.
- Removed unused `getrandbits`/`randbelow` from the PRNG after the Original
  engine's removal. Integer-seeded `random()` is required for current deterministic
  generation and remains, with independent goldens.
- Removed the fully expanded dictionary map, old JSON dictionary and duplicate
  upstream text. Retained the compact binary, upstream checksum and licenses.
- Removed the separate web package, lockfile, tsconfig, Python fixture build
  command and Python CI setup. Root npm commands now build/test both runtimes.
- Removed the old HTTP/2/browser throughput spike scripts, production benchmark
  duplicate, probe script and obsolete Lighthouse-summary script. Retained one
  parameterized live browser benchmark plus CPU/load/memory/UI verification tools.
- Removed `web/docs`' tracked screenshots (before/v1/v2/live/comparison), boat.dev
  reference images, full and aggregate benchmark JSON, source hashes, old test
  output, deployment notes, port plan and superseded architecture/design briefs.
  Reports now write to ignored `web/docs/`; permanent conclusions live in
  `docs/performance.md`, `docs/architecture.md`, and `docs/verification.md`.
- Removed old `docs/domain-lookup-history.md`, `domain-lookup.md`,
  `domain-lookup-dns.md`, its bulky JSON and `project-comparison.md`; retained the
  important measurements and current domain semantics in the new docs.
- Removed repeated Promise.race subscriptions in ordered search, main-thread
  generation, unbounded result-row DOM, and old search metadata retained across
  unrelated searches.

No old preference-key migration exists in the current code. The v2 preference
key and v1 shortlist backup format are active user data, not obsolete migration
logic, and remain unchanged. No fallback import for removed Original settings
was added; unknown stored controls are ignored by ordinary current-field loading.

### Preserved and potentially debatable

Reverse, exact inversion, substitutions, supplied syllables/ARPABET, arbitrary
integer seeds, lookup tuning, cache management, shortlists and all exports remain.
The sound-model research documents (`research-direction.md`, `sound-dials.md`,
`control-hierarchy.md`) remain because they explain the model's assumptions and
limits. They are historical rationale, not product-validated psychological claims.
The service worker and self-hosted font subsets remain for current offline and
visual behavior. None of these was treated as legacy without evidence.

### UI differences

The only removed visible control is Advanced → Engine and its Original-style
choices. Default feed, Tune, name sheet, Reverse and Shortlist keep the v2 CSS,
fonts, labels and interactions. Above 200 names, off-screen rows recycle while
retaining order, scroll-back, keyboard traversal and full CSV export. Generation
moves to the worker; the existing loading state now also covers local-generation
work. Screenshot timestamps/progress can differ because those are live values.

### Fixture provenance

Captured from the pre-migration Python revision recorded in
`tests/parity.json.provenance`, including source SHA-256 values: 58 generation
cases, three 10,000-name sequences, 13 direct pronunciations and reverse reports,
six inverter grids (top ten), ten substitution reports, and four PRNG seeds.
The whole dictionary's independent expanded digest covers all 126,052 words.
No retained capability has an intentional parity exception. Removed Original
styles and their associated unused PRNG methods are the only discarded cases.

One necessary presentation-only fixture adaptation: suggested commands in Reverse
reports now start with `node dist/cli.mjs` instead of `python3 name_generator.py`.
The raw Python fixture is preserved, and the parity test normalizes only that
launcher prefix. Dial fits, scores, structures, pronunciations and names still
match exactly. The expandable raw report reflects this new CLI command.
