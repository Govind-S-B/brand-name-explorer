# Brand name explorer — static web app

A dependency-free browser runtime in TypeScript, built with Vite. The Python CLI
is unchanged. No backend, Pyodide, account, API key, downloaded domain dataset,
or cross-origin-isolation headers are required.

## Run locally

Requires Node 22.12+ (or 24+) and npm. The compact CMU asset is checked in, so
building/running the app does not require Python.

```bash
cd web
npm ci
npm run dev
```

For the exact production preview used by the tests (gzip, a 600-second HTTP
cache, a repository subpath, and no COOP/COEP):

```bash
npm run build
npm run preview:pages
# http://127.0.0.1:4173/brand-name-explorer/
```

`npm run preview` also serves the Vite build at the root. `base: './'` keeps
assets, module workers, the dictionary, and the service worker relative to the
current repository path. GitHub Pages can serve `web/dist/` as-is. The optional
`.github/workflows/web-pages.yml` is **manual-only** (`workflow_dispatch`); it was
triggered manually to deploy the current `main` branch. The live URL is
https://govind-s-b.github.io/brand-name-explorer/.

## Capabilities

- **Defaults:** a browsing feed with the CLI's defaults. You land on possibly
  available .com names only (`--hide-registered`), 20 per page, with lookups
  starting automatically. Up to 4,000 per page are available, and Python's
  default count remains 200.
- **Tune:** all seven mood recipes, blends, explicit dials, structure and spelling
  controls, integer seeds, original styles, pagination (Load more and a start
  page) and lookup tuning. Tune is a bottom sheet on phones and an inline panel on
  desktop. [UX plan](docs/ux-v2.md).
- **Analysis:**
  - the reverse finder, with CMU or supplied pronunciation and explicit
    representation gaps;
  - the exact-spelling inverter over the 1,331-point dial grid;
  - opt-in substitution beam search.
  - Analysis runs in its own worker and makes no domain requests. The inverter and
    substitutions live in each name's sheet and as Reverse follow-ups.
- Independent DNS and RDAP schedulers in a lookup worker. Six RDAP slots and
  12 DoH slots per provider; paced starts, retry timers outside slots, persistent
  provider cooldowns, congestion backoff, and strict RDAP-confirmed availability.
- IndexedDB domain/DNS records and ordered filtered-session progress, with
  transactional commits before output. Session identities exclude page size and
  lookup tuning. Page two checks the full filtered prefix; it does not skip
  earlier candidates. Refresh resets the selected session's freshness boundary.
- An in-flight search pauses when the document becomes hidden/offline and resumes
  when visible/online. Reload resumes the landing search automatically. It never relies
  on a background tab or service worker continuing a search. Completed out-of-order
  checks stay cached. After an abrupt stop, a short rejected prefix may replay.
- Separate localStorage shortlist with JSON backup/import, independent of cache
  clearing; CSV result export. Browser data is evictable: a downloaded backup is
  the portable copy. Persistent-storage permission is requested on checking.
- Scoped, versioned service-worker shell precache with hashed assets. Generation
  works offline after the first successful load. The compact 126,052-word CMU
  dictionary is fetched only when analysis needs it, then cached for offline use.
  Supplied ARPABET and unsegmented engine readings do not need that asset.

## Verify

```bash
npm test
npm run build
# Start npm run preview:pages, then in another terminal:
npm run test:browser       # real RDAP + DoH, screenshots, axe, offline, export/import
npm run test:resume        # deterministic mocked responses, ordering, reload/resume
npm run benchmark:production  # live 200-result production worker, empty browser stores
npm run measure:load      # cold / repeat / offline production loads
```

Browser scripts use the installed macOS Chrome. `CHROME_PATH` overrides it for
most runners. The mocked recovery runner and HTTP/2 experiment use the macOS
path directly. Install Chrome or update those paths on other platforms. The
manual Pages workflow runs pure parity/scheduler tests and builds; it does not
run network benchmarks or require Chrome.

`node scripts/design-screens.mjs` (with the preview running) captures every UI
state at 390 px and desktop against mocked providers.

`python3 -I scripts/fonts.py SOURCE_DIR` rebuilds the font subsets in `src/fonts/`.
It needs `fonttools` and `brotli`, and the OFL sources listed in the script.
Licences ship as `fonts-LICENSE.txt`.

`npm run fixtures` uses the unchanged parent Python code and bundled dictionary
to regenerate the compact asset, shared inventories, and parity fixtures. This
is a development command, never a browser runtime dependency. The preserved CMU
license is linked in the interface and included in production output.

- [UX v2 plan and information architecture](docs/ux-v2.md)
- [Interface design brief (boat.dev standard)](docs/design-brief.md)
- [Browser measurements and design choices](docs/browser-throughput.md)
- [Verification, bundle sizes, and load results](docs/verification.md)
- [Implementation and limitations](docs/architecture.md)

No trademarks, meanings, or purchase availability are certified. A valid RDAP
404 means “possibly available”; a registrar must confirm it.
