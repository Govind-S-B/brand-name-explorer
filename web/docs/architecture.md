# Implementation notes

## Source boundaries

`src/core/` ports the forward grammar, CPython integer-seeded MT19937,
pronunciation, exact inverter, reverse reports, and bounded substitution search.
Shared inventories/recipes are generated into `constants.json` from the unchanged
Python source. Fixtures are generated independently by Python, not by the port.
The browser retains CPython's random() and getrandbits/_randbelow behavior rather
than substituting a JavaScript PRNG. No Python source is loaded by the app.

The interface markup is static. `index.html` holds the header, tabs and footer.
`src/shell.ts` renders the panels into `index.html` at build time through a small
Vite plugin, so the controls paint before JavaScript runs. `main.ts` attaches
behaviour to that markup and handles local generation and portable
shortlist/preferences storage. Inputs and stored labels are rendered with text
nodes; user text is never interpreted as HTML. The analysis worker isolates the
inverse grid and phoneme beam search. The lookup worker isolates the network
scheduler and IndexedDB from UI work.

## Lookup scheduling

The worker reads up to 256 speculative candidates, counts completed registered
rows out of the remaining-match budget, and consumes committed results in seed
order. A slow earlier name therefore does not stop useful later dispatch, while
lookahead remains bounded. Results can finish out of order and enter the durable
cache; the session cursor cannot advance past an unresolved earlier name. Errors
stay unknown. All available results originate from a validated RDAP 404.

Each resolver has an independent gate, 12 fetch slots, and an adaptive budget
(start 16, ceiling 40/sec); provider assignment is stable by domain hash. RDAP
has six slots, starts at 8 attempts/sec, and ramps to a ceiling of 30. Rates rise
25% per 20 successes. A pending DNS request can fill an idle RDAP slot after
250 ms, but DNS-completed RDAP work takes priority. Late DNS positives never
replace an already-dispatched RDAP decision. DNS errors/timeouts go to RDAP;
there is no DNS retry loop. DNS normally times out at 2 seconds and RDAP at 8.

Retries use a not-before timestamp, never a sleeping fetch slot. RDAP transport
failures receive up to six attempts and other retryable failures three. Backoff
is exponential with jitter; provider Retry-After is respected when CORS exposes
it. 429 halves that provider's rate and persists its cooldown in IndexedDB.
HTTP overload also shares an RDAP cooldown. DNS cooldown sends queued DNS work
to RDAP without affecting the RDAP budget. Provider identities are not rotated
in response to throttling. Four correlated errors in a 32–64-response window
reduce RDAP concurrency/rate by 25%; 64 healthy responses recover one slot.
The browser handles TLS, address selection, and connection reuse itself.

A Web Lock prevents competing lookup workers across tabs on browsers supporting
that API. Without Web Locks, use one active checking tab per origin. This lock
coordinates only this app's origin, not unrelated tabs or other software.

## Durable state and lifecycle

IndexedDB stores `domains`, `dns`, `metadata`, `sessions`, and indexed `matches`.
Domain results and NS evidence are committed before successful futures resolve.
A session's cursor and new matches commit in one transaction before emitting a
match. Rejected-only prefixes checkpoint every 64 candidates and on stop/error.
Duplicate in-flight checks share a promise keyed by domain and freshness.

DNS evidence has a TTL (NS capped at one day; negatives at five minutes).
Successful domain records and saved pages are explicit snapshots until refresh;
TTL expiry does not silently reshuffle a saved page. Restarting preserves provider
cooldowns. Refresh bypasses older DNS and RDAP evidence for the selected session.
Session progress uses a stable sorted-settings SHA-256 key, independent of page
size/rate controls. Cached reads need no external request.

A visible document starts the worker; hiding it aborts fetches and saves the
committed prefix. Returning/going online resumes from it. Reload retains an
explicit Resume action. The service worker never performs domain checks and
cannot make iOS background execution reliable. If the browser kills the entire
process before a final checkpoint, replay uses completed domain-cache records.

Shortlisted names are application data in a separate localStorage key. Clearing
lookup cache preserves them and saved session pages. JSON export/import is the
user-controlled copy outside browser storage; localStorage and IndexedDB can
both be evicted, regardless of persistence permission. Storage failures surface
as errors, rather than publishing an uncached success as durable.

## Static delivery and offline

Vite emits relative hashed assets, including both workers and the compact CMU
asset. The generated service worker scopes URLs to the repository directory.
It precaches the shell and analysis code, but excludes the dictionary; that
hashed asset enters a separate cache only after use. Same-origin shell assets
are cache-first; navigations try the network and fall back to cached index.html.
RDAP and DoH cross-origin requests are never service-worker cached. New worker
versions wait for old clients to close, so an update does not force a mid-search
reload. Old shell caches are removed on activation of the new version.

No SharedArrayBuffer, OPFS, SQLite/WASM, COOP, or COEP is required. Node and npm
are build/development tools only. GitHub Pages' ordinary compression and roughly
10-minute HTTP caching are sufficient; versioned asset names and service-worker
caches provide the repeat-load behavior.

## Known limits

- Chrome mobile emulation is not a physical iPhone/Safari suspension or cellular
  test. Modern AbortSignal.any/timeout, IndexedDB, workers, crypto, and service
  workers are expected (roughly Safari 17.4+, recent Chrome/Firefox).
- Browser fetch hides many transport details and may not expose Retry-After.
  No HTTP 429 was observed live; throttling/backoff were verified with fake
  providers as well as parser tests.
- The live production benchmark covers 200 available results per browser profile;
  it is not a 4,000-result browser endurance test. The earlier Python 4,000-result
  benchmark remains separate evidence.
- Restoring a late cursor regenerates/skips the deterministic prefix. The lookup
  worker yields every 256 skipped words, but very large prefixes can take time.
  The generator's removed-prefix state grows with explored names. Generating
  thousands on the main thread can exceed one frame on slower phones.
- CMU is 817 KB gzip on first use and mainly US English. It is optional for
  generation and explicit engine/ARPABET input, but dictionary-based analysis
  needs one online fetch before it works offline.
- Pages deployment and live github.io service-worker behavior have not been
  tested; a local repository-subpath preview was tested instead.
