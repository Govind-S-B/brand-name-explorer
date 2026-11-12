# Lean TypeScript migration

Status: baseline capture. Branch: `lean-refactor`.

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
