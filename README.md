# Brand name explorer

Explore names by their sound, with live **.com availability checks**.

**[Open the web app](https://govind-s-b.github.io/brand-name-explorer/)**

Start with a feed of possibly available names. Tap the mood chip in the heading
to open **Tune** and choose a mood, blend recipes, change sound dials or adjust
the spelling. Tap a name for its
sound breakdown and nearby spellings. Reverse finds settings for a name you
like; Shortlist saves your favourites and offers a portable JSON backup.

Every name in Explore, Reverse, nearby suggestions and Shortlist opens the same
name sheet and has a save heart. Follow a nearby name and use Back to return to
the previous name and its suggestions.

Each new visit starts with a fresh seed. **History** keeps the latest 100 searches
in this browser, with their time, seed and full settings. Open an entry to inspect
it, then choose **Run again** to reuse that configuration. **Settings** lets you
clear history or keep the same seed on reload.

Every “possibly available” result is RDAP-confirmed. DNS only filters registered
names. Registry absence does not guarantee purchase availability; confirm with
a registrar. Sound preferences are experimental, not measured emotions.

<p>
  <img src="https://github.com/Govind-S-B/brand-name-explorer/releases/download/assets/mobile-feed.png" width="240" alt="Mobile name feed">
  <img src="https://github.com/Govind-S-B/brand-name-explorer/releases/download/assets/tune.png" width="240" alt="Tune mood sheet">
  <img src="https://github.com/Govind-S-B/brand-name-explorer/releases/download/assets/name-sheet.png" width="240" alt="Name sound analysis sheet">
</p>

![Desktop explorer](https://github.com/Govind-S-B/brand-name-explorer/releases/download/assets/desktop.png)

Screenshots are hosted as [GitHub Release assets](https://github.com/Govind-S-B/brand-name-explorer/releases/tag/assets), outside the source tree.

## Run locally

Node **24.12+** and npm. No Python, backend, API key or runtime npm dependencies.

```sh
npm ci
npm run dev
# Production:
npm run build
npm run preview:pages
# http://127.0.0.1:4173/brand-name-explorer/
```

The web app works offline after its first successful visit. The optional CMU
pronunciation dictionary downloads only when a reading needs it. Names saved in
a browser can be evicted; download a Shortlist backup for a portable copy.

## Node CLI

Build once with `npm run build`, then run `node dist/cli.mjs` (or `npm run cli -- …`).
The default is **200 possibly available .com names**, calm mood, six letters,
seed 42, page one. Lookup caches and ordered pages persist in `.cache/names.sqlite`.

```sh
# Immediate generation, without network work
node dist/cli.mjs --no-check-com --count 20

# Search with mood, blend, dials and spelling controls
node dist/cli.mjs --mood grounded --blend playful:0.3 --energy 7 --length 7
node dist/cli.mjs --mood lyrical --opening vowel --syllables 3 --ending open

# Deterministic pages; cached pages reopen without network requests
node dist/cli.mjs --count 200 --page 2 --seed 42
node dist/cli.mjs --refresh --cache .cache/fresh.sqlite
node dist/cli.mjs --no-hide-registered --count 20

# Inspect the engine without generating names or making requests
node dist/cli.mjs --list-moods
node dist/cli.mjs --list-dials
node dist/cli.mjs --explain --mood strange --novelty 8

# Analysis (JSON output)
node dist/cli.mjs reverse figma
node dist/cli.mjs reverse shien --reading she-en
node dist/cli.mjs invert lemoru
node dist/cli.mjs substitute lemoru --phones 'L EH1 M OW0 R UW0' --count 5

node dist/cli.mjs --cache-stats
node dist/cli.mjs --clear-cache
node dist/cli.mjs --help
```

Checked output is TSV: domain, status, source. Generated output is one name per
line; diagnostics go to stderr. Ctrl-C saves committed progress; rerun to resume.
`--refresh` starts a fresh filtered session. Clearing lookup cache preserves
saved session pages. Only one CLI process may use a cache at once.

Node defaults to 32 RDAP slots with an adaptive 160 attempts/sec ceiling, plus
independent DoH pools. `--lookup-workers`, `--lookup-rate`, `--dns-workers`,
`--dns-rate` and `--no-dns` control them. Provider cooldowns and retries are shared
and persistent. The browser independently caps RDAP at six active fetches.
These ceilings are application settings, not claims about provider quotas.

## One engine, two adapters

- `core/`: pure TypeScript generation, pronunciation, reverse finding, exact
  inversion and substitutions; compact dictionary lookup.
- `lookup/`: provider parsing, adaptive scheduling and ordered durable searches.
- `web/`: static HTML, vanilla views, workers, IndexedDB and offline caching.
- `cli/`: Node argument parsing and SQLite persistence.

One npm package, one build, one Node test runner. No Original-style engine or
legacy cache migration is retained. Existing v2 web preferences and shortlists
remain supported as current application data.

```sh
npm test
npm run build
# With preview:pages running:
npm run test:resume
npm run test:browser
node web/scripts/verify-feed.mjs
```

[Architecture](docs/architecture.md) · [Performance](docs/performance.md) ·
[Verification](docs/verification.md) · [Migration/removals](docs/migration-plan.md) ·
[Sound model](docs/control-hierarchy.md) · [Dictionary provenance](data/README.md)
