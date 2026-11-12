# Verification

Run from the root with Node 24.12+, npm and installed Chrome. `CHROME_PATH` can
select another Chrome executable in the newer harnesses. Older recovery/load
harnesses use the standard macOS Chrome path.

```sh
npm ci
npm test
npm run build
npm run preview:pages
# In a second terminal:
npm run test:resume
npm run test:browser
npm run test:names
npm run test:check
node web/scripts/verify-feed.mjs
node web/scripts/design-screens.mjs /tmp/bne-screens
npm run measure:memory -- /tmp/bne-memory.json
npm run measure:load
npm run benchmark:core
COUNT=200 npm run benchmark:browser -- /tmp/bne-200.json
COUNT=4000 npm run benchmark:browser -- /tmp/bne-4000.json
node dist/cli.mjs --count 200 --cache /tmp/unique-cold-200.sqlite
node dist/cli.mjs --count 4000 --cache /tmp/unique-cold-4000.sqlite
```

Use unused cache paths/browser contexts for cold runs. Run performance tools
sequentially; do not compare measurements while another benchmark is active.
Reports and screenshots are ignored artifacts; the concise permanent record is
[performance.md](performance.md). Screenshots for the README live on the `assets`
GitHub Release. The pre-migration baseline and full evidence for this migration
were captured outside the repository in `/private/tmp/bne-migration/`.

The suite covers independent Python goldens, all dictionary readings, provider
validation, independent DNS/RDAP budgets, bounded retry/backoff, failure handling,
Node CLI arguments, SQLite atomic pages, changed page sizes, cancellation/resume,
fresh checks and concurrent-CLI exclusion. Browser tests cover real providers,
name-sheet analysis without the dictionary, lazy dictionary and offline analysis,
shortlist backup/import, keyboard tabs and zero axe violations. Controlled
recovery tests use delayed fake providers; live results are not synthetic.

The 8,000-name feed test checks bounded rendered rows, scroll-back, keyboard
traversal across recycled blocks, all 8,000 unique CSV rows and zero axe issues.
Screenshots cover 18 states at 390 × 844, 360 × 740 and 1440 × 900. CSS and fonts
are unchanged; the only removed control is the Original Engine selector.

Physical iPhone/Safari suspension, actual cellular links and unlimited feed
length are not established by desktop Chrome emulation. Internet benchmarks are
individual observations with uncontrolled remote resolver/registry caches.
Availability remains a timestamped RDAP observation, not a purchase guarantee.

`test:names` exercises the shared name rows at 360, 390 and 1440 px with mocked
providers: all entry points, direct favourites, nested modal Back/Close and focus,
child configuration application, preserved reference readings and text-only
shortlists, asynchronous navigation, shared domain status and zero axe violations.
It defaults to the preview on port 4174; use `BASE_URL` to select another preview.
Screenshots go outside the tree to `/private/tmp/bne-name-affordances` by default
(`EVIDENCE_DIR` overrides this). This suite does not certify domain availability.

`test:check` uses controlled providers at 360, 390 and 1440 px. It verifies the
adjacent icon/44 px target, keyboard activation, duplicate-click suppression,
shared results across modal Back and Shortlist, cached reopening without network,
fresh refresh, failures with/without earlier results, offline/retry, and no domain
control for text references. At 390 px it also checks feed completion/pause/change,
separate feed counters, close/reopen during a request, mid-request offline, and
another tab holding the lookup lock. All tested states have zero axe violations.
Screenshots live outside the repo in `/private/tmp/bne-inline-check` by default.

Set `HEAP_SNAPSHOTS=1` for `measure:memory` to also save CDP heap snapshots beside
the JSON report. The report separates V8 used heap, backing storage and embedder
heap after explicit GC; these are not process RSS or physical-phone measurements.

## Migration result

- 130 Node tests pass; the original baseline had 79 Python and 134 web tests.
  Removing 27 Original-engine cases and adding direct pronunciation, long-sequence,
  whole-dictionary, CLI and SQLite recovery coverage explains the changed count.
- Exact algorithm parity holds for retained functionality. The only normalized
  output is Reverse's suggested command launcher (`node dist/cli.mjs`).
- Desktop and 390 px live-provider verification: zero page errors, failed local
  assets, overflow or axe violations. Axe waits for finite row transitions to
  settle so it measures final colors, rather than intermediate animation opacity.
- 54 baseline/final screenshots: **43 pixel-identical**; the remaining 11 differ
  by at most 1.08% of pixels. Inspected differences are check timestamps, focus/
  hover/animation capture and composited sheet background, without layout changes.
  The 390 px feed and Tune snapshots are pixel-identical. CSS and font files are
  unchanged. Advanced's removed Original Engine control is the deliberate exception.
- Final local Lighthouse: performance 100, accessibility 100, TBT 0; see
  [performance.md](performance.md) for the full measurements and limits.

## Published application

[Pages run 43258558427](https://github.com/Govind-S-B/brand-name-explorer/actions/runs/43258558427)
succeeded from `f49550aca3895823f3d179dc949ebb6e86e1cb51`, including npm clean
install, all 130 tests and the production build on Node 24. The live URL is
https://govind-s-b.github.io/brand-name-explorer/.

Post-deployment verification fetched **all 14 published files**, including lazy
workers, dictionary and service worker: HTTP 200 and exact SHA-256 equality to
the local production build. Live desktop and 390 px Chrome tests completed real
RDAP/DoH lookups, name and Tune sheets, Reverse, portable shortlist backup/import,
offline generation and offline dictionary analysis: zero page errors, failed
same-origin assets, overflow or axe violations.

The [assets release](https://github.com/Govind-S-B/brand-name-explorer/releases/tag/assets)
hosts four v2 README PNGs. GitHub was used directly without an additional image
hosting account. Those captures use deterministic mocked provider answers; they
illustrate UI state rather than certify current availability of example names.
