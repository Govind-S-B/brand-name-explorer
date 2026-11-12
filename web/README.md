# Web adapter

Run commands from the repository root: `npm ci`, `npm run dev`, `npm run build`.
Production output is `web/dist/`. `npm run preview:pages` serves it under the same
`/brand-name-explorer/` subpath as GitHub Pages.

The static HTML shell, vanilla views, workers, IndexedDB adapter and fonts live
here. Algorithms and lookup scheduling are shared with the CLI.

See [the main README](../README.md), [architecture](../docs/architecture.md),
[locked UX](../docs/ux-v2.md), [verification](../docs/verification.md), and
[measured performance](../docs/performance.md).
