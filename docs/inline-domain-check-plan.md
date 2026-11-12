# Inline domain check

Keep the shared name sheet. Group its status pill with a quiet 18 px refresh
icon inside a 44 px touch target. The accessible name/tooltip says Check, Refresh
or Retry for the domain. Checking spins the icon (unless reduced motion is on),
announces progress, and prevents duplicate requests. Save remains independent.

Opening a name reads the durable cache only. Clicking always requests a fresh
check. Show a timestamp for confirmed results; failures retain any previous
result with an explicit refresh-failed note. Offline checks explain how to retry.
Text-only references have no domain controls. External registry links remain
separate. Navigation/Close never makes a late result paint another name.

Reuse one lookup engine and browser lock while either a feed or manual check is
active. Give manual jobs priority within existing provider limits. Finishing a
feed discards speculative jobs while retaining manual jobs. Pausing/changing a
feed closes its engine and automatically reschedules interrupted manual checks
on the next engine. Release the engine/store/lock when both are idle. One-name
results update shared status and cache, without adding feed rows or advancing its
pagination/lookup counters. Refreshing a displayed name updates the availability
total when its status changes.

Sequence: worker lifecycle and scheduler tests; shared transient UI state and
control; browser checks at 360/390/1440, including pending navigation, duplicate
clicks, refresh/errors/offline/cache and feed pause/change/completion; existing
regressions/build/axe, bundle measurement; publish and verify a live 390 px check.

## Local verification

- 139 unit tests pass, including exact Python golden parity, scheduler priority,
  separate feed counters, cancellation retaining explicit jobs, and waiting for
  aborted provider cleanup before replacing an engine.
- New `test:check` passes at 360, 390 and 1440 px with controlled providers. It
  covers fresh/retry/offline/cache, shared status, modal navigation/Close, saving
  during checks, duplicate clicks, feed completion/pause/change, cross-tab lock,
  keyboard activation, 44 px hit target and zero axe violations.
- Existing shared-name, real-provider browser and pause/reload/resume suites pass.
  The memory harness renders 100–200 rows at 8,000 names. Mobile Lighthouse is
  100 performance / 100 accessibility, LCP 752.9 ms, TBT 0.
- Entry JS grows by 643 gzip bytes; CSS by 37. Detailed observations and limits
  are in performance.md. Visual changes are limited to the adjacent icon,
  progress/error copy, and the clearer external Registry label.
