# GitHub Pages deployment — 12 November 2026

Live: **https://govind-s-b.github.io/brand-name-explorer/**

[Successful Actions deployment](https://github.com/Govind-S-B/brand-name-explorer/actions/runs/43225800126)
of `bc313369fdd6bdb4fa8191d82f819a127eba8b33`. Pages uses the GitHub Actions build
type. The workflow is manual (`workflow_dispatch`); pushing future commits does
not automatically publish them. No repository settings other than enabling
Pages were changed.

## Integration and public files

The remote `14437d3` README edit was merged with local `9c663fc`, without rebasing
or force-pushing. The README keeps the user's image URL and complete motivation
text, plus the local web, reverse-finder and domain-lookup documentation.

Commits pushed for the initial deployment:

| Commit | Change |
| --- | --- |
| `9c663fc` | Existing local sound-engine/inverse/substitution work |
| `3afec1d` | Merge the user's remote README commit |
| `32677a1` | DNS pre-filter and concurrent durable CLI lookup |
| `6b43dac` | TypeScript naming and worker lookup engines |
| `535a6ba` | Current compact responsive interface and design evidence |
| `bc31336` | Pages workflow and documentation |

A subsequent documentation/test-evidence commit records these live results; it
does not change the deployed app's bytes. The live asset hash test establishes
that all published files match the current local production build.

The initial push adds about **15.5 MB uncompressed** relative to the previous
remote head, including the existing local commit's bundled CMU source. About
11.8 MB is new work from the DNS/web/design phases. The additional live screenshot
and verification evidence brings the total to roughly **16 MB**. The largest
files are dictionary assets and referenced design screenshots. Dependencies,
builds, Vite caches, local lookup databases/sidecars/sessions, Python bytecode,
progress logs, raw per-request browser traces, and full Lighthouse reports are
excluded. Compact aggregate reports and referenced screenshots are kept.

A pattern scan over all candidate public text files found no private keys,
GitHub tokens, AWS access keys, common API tokens, or credential assignments.
No secret-scanner finding was suppressed. This is a pattern check, not a claim
that arbitrary undisclosed secrets can be detected perfectly.

## Verified checks

Before pushing, both local suites passed: **79 Python tests** and **134 web
tests**, following `npm ci`; the TypeScript/Vite/service-worker build passed.
Both suites and the clean production build also passed on the GitHub runner.
All eight Python source hashes match the start-of-port snapshot.

[Live asset evidence](live-assets.json): **all 13 published files** returned HTTP
200 and matched the local build byte-for-byte by SHA-256. This includes the HTML,
CSS, JS, both workers, fonts, licenses, service worker, and lazy dictionary. All
asset URLs remain under `/brand-name-explorer/`.

[Live browser evidence](live-browser-verification.json), installed headless Chrome:

- Desktop at 1440 × 1000 and mobile emulation at **390 × 844**: generation works
  before external lookups and produces 24 names.
- Real lookup from `github.io`: all 24 statuses resolve per profile. Desktop uses
  12 RDAP requests and 24 DoH queries, skipping 12 RDAP checks; mobile uses
  11 RDAP requests and 24 DoH queries, skipping 13. Browser responses are observed
  from **Verisign, Cloudflare, and Google**, confirming usable cross-origin fetches.
  DNS cannot produce an available result; available rows require RDAP confirmation.
- **No same-origin HTTP errors/404s, page errors, horizontal overflow, or axe
  WCAG A/AA violations** on either profile.
- The service worker activates and controls the page with repository scope
  `https://govind-s-b.github.io/brand-name-explorer/`.
- An offline reload and Generate work after installing the service worker. The
  verifier sets the browser context offline; offline dictionary analysis also
  works after first use. The earlier [local outage test](verification.md#bundle-and-load-performance)
  additionally stops its server, covering Chrome's service-worker-update requests
  that may bypass context offline emulation.
- Reverse finder, inverter, substitutions, shortlist backup/import, and cache
  clearing that retains saved names pass on both profiles.

Screenshots captured from the live site and visually inspected:

- [390 px phone](screenshots/live-mobile.png) · [full phone page](screenshots/live-mobile-full.png)
- [Desktop](screenshots/live-desktop.png) · [full desktop page](screenshots/live-desktop-full.png)

## Live Lighthouse mobile

Measured on the public URL with Lighthouse's default mobile simulated throttling,
fresh Chrome profile, and no automatic domain work during load:

| Metric | Result |
| --- | ---: |
| LCP | **0.958 s** |
| Total blocking time | **0 ms** |
| Performance | **100 / 100** |
| Accessibility | **100 / 100** |
| CLS | **0** |
| Audited transfer | **38,839 bytes** |

[Compact Lighthouse evidence](lighthouse-live-mobile-summary.json). No audit
warnings were reported. The transfer audit omits some worker/service-worker
installation traffic; the local complete-shell measurement is separately
documented. These numbers are a single measured load, not a latency guarantee.

## Reproduce

```bash
cd web
npm ci
npm run build
node scripts/verify-live-assets.mjs
BASE_URL=https://govind-s-b.github.io/brand-name-explorer/ EVIDENCE_PREFIX=live- \
  node scripts/verify-browser.mjs
./node_modules/.bin/lighthouse https://govind-s-b.github.io/brand-name-explorer/ \
  --chrome-path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --chrome-flags='--headless --no-sandbox' \
  --only-categories=performance,accessibility --output=json --output=html \
  --output-path=docs/lighthouse-live-mobile --quiet
```

Keep performance runs separate from other active browser tests. Full Lighthouse
reports are generated locally and ignored. To publish a future change:

```bash
gh workflow run web-pages.yml --repo Govind-S-B/brand-name-explorer --ref main
```

Physical iPhone/Safari suspension and a 4,000-result browser endurance run remain
unverified. Browser storage is evictable; downloadable shortlist backups remain
the portable copy of saved names. No other open deployment failure was found.
