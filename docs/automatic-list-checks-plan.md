# Check discovery lists on display

Nearby spellings, Reverse references/samples and Shortlist should show .com
availability without opening each name. Render names immediately, then use the
existing shared lookup worker to check their domains. Update pills in place;
retain registered names and the existing row order, hearts and full modal.

Only displayed lists start automatic work: no checks for the hidden startup
Shortlist, hidden Reverse results or detached modal history. Existing checks
continue safely after navigation. Reopening a list reuses results checked within
five minutes; older results are refreshed. Worker cache reads use the same
freshness threshold, so reloads also reuse recent evidence. Explicit refresh
always requests a new check. All appearances of a domain share pending/results.

Offline lists read cached results and explain missing checks. Reconnection checks
the displayed lists automatically. Errors stay unconfirmed and offer the existing
subtle Retry control. Text references without a valid .com stay excluded. Explore
retains its automatic-check preference, pagination and provider limits; discovery
lists share its scheduler without adding feed rows or lookup counters.

Implement through a discovery-row factory using the existing shared renderer and
one check function. Update old tests that expected analysis lists to remain
unchecked. Verify automatic Nearby/Reverse/Shortlist checks, deduplication, fresh
and stale cache, hidden lists, offline recovery, navigation, manual refresh and
concurrent Explore. Run unit/build/browser/axe checks at 360/390/desktop, record
bundle impact, publish and verify the live 390 px flow with actual lookups.
