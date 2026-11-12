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
active. Give manual jobs priority within existing provider limits. Cancelling or
finishing a feed discards its speculative jobs while retaining manual jobs;
release the engine/store/lock when both are idle. One-name results update shared
status and cache, without adding feed rows or advancing its pagination/counters.

Sequence: worker lifecycle and scheduler tests; shared transient UI state and
control; browser checks at 360/390/1440, including pending navigation, duplicate
clicks, refresh/errors/offline/cache and feed pause/change/completion; existing
regressions/build/axe, bundle measurement; publish and verify a live 390 px check.
