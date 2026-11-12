# Shared name rows and modal — implementation plan

Use the existing Explore row and name sheet as the standard. Preserve the v2
appearance and the heading mood chip. No changes to generation or ranking.

## Visible behavior

- Explore, Shortlist, Nearby spellings, Reverse samples and the Reverse reference
  use one name row: name, domain/check status, and a separate favourite heart.
  The name area opens the same modal; the heart saves without opening it.
- Nearby rows add their sound/structure explanation below the metadata. If only
  spelling length changes, explicitly say “Same sounds · 1 extra letter”.
- Reverse keeps its settings groups and group-level Explore similar action.
  Individual samples become normal name rows inside each group.
- The full modal offers Save, Copy, registry/site link, sound details, Explore
  similar when a configuration exists, and Nearby spellings. Unchecked domains
  are labelled “Not checked yet”; the registry link remains external. Browsing
  suggestions does not start background domain checks.
- Opening a nearby name replaces the modal content. “Back to Goftu” restores the
  previous analysis, suggestions, focus and scroll. Close/Escape returns to the
  original list. Keep at most 20 prior modal views, released on close.
- Save state is shared across every occurrence. Status updates from the existing
  lookup worker update visible duplicates and the open modal, without changing
  the Explore feed's pagination or lookup counters.
- Reverse references retain their analysed reading when opened. A name outside
  the generator's grammar explains why configuration fitting is unavailable;
  Save and Copy still work. Non-domain references can be saved as text, with no
  silently invented .com address or registry link.

## Implementation sequence

1. Extract the existing row renderer and name identity helpers. Keep DOM actions
   delegated and pass the shared row factory into the lazy analysis UI.
2. Replace plain Nearby/Reverse names; add contextual descriptions and correct
   initial heart states. Retain existing saved names and portable backups.
3. Add bounded modal history, focus handling and stale-response protection.
   Route analysis responses by request ID so an underlying Reverse request and
   modal analysis cannot discard one another's results.
4. Add integration checks for all entry points, shared saves, restore/back,
   keyboard access, unknown/registered/available states, invalid references,
   configuration application and asynchronous navigation. Run existing tests,
   build, browser smoke/recovery checks, and visual/axe checks at 360, 390 and
   desktop widths. Record bundle impact.
5. Commit, fast-forward main, publish via the manual Pages workflow and verify
   the deployed 390 px app with real lookups.

## Acceptance

Goftu → Nearby → Goftoo opens Goftoo's full modal; Save persists to Shortlist;
Back restores Goftu and its suggestions. Each Reverse sample and the reference
itself opens that same modal. Explore similar uses the opened name's settings,
not the previous name's. Unchecked names never appear available without an
RDAP-confirmed result. No new runtime dependency or dictionary on initial load.

## Verification result

- 136 Node tests pass, including saved-name identity/import validation and
  out-of-order worker responses, cancellation and worker-error recovery.
- Shared-name browser checks pass at 360, 390 and 1440 px, including the user's
  Goftu → Goftoo example, direct hearts, full child modal, restored results/scroll/
  focus, Reverse reference/sample/nearby entry points, child configuration,
  pronunciation persistence, non-domain references and shared lookup status.
- A 22-name chain retains exactly 20 Back steps; Close releases the chain.
- Existing real-provider desktop/mobile smoke, offline/reload/resume and
  8,000-name recycled-feed/CSV checks pass. All tested views have zero axe issues.
- Entry JS grows by 1,193 gzip bytes (7,727 → 8,920); CSS by 2 bytes.
  Main V8 is 2.142 → 2.160 MB on landing and 2.941 → 2.946 MB at 8,000 names.
  Analysis-worker V8 plus backing storage remains about 2.266 MB.
  See performance.md for measurement limits. No lookup/generator algorithm change.
