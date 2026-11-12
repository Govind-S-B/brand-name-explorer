# UX v2 — a browsing app, not a workbench

Round-one feedback: the interface felt unconsidered, too dense and too much like a dev tool.
v2 is mobile-first and consumer-shaped. You land on a feed of names that are
already filtered and simply browse. Configuration is opt-in, above the feed,
folded by default. boat.dev remains the bar for craft (type, restraint and
precise states), not a template for density.

## Defaults (match the Node CLI)

| Setting | CLI default | Web v2 |
| --- | --- | --- |
| Mood, opening, syllables, ending | calm, any, automatic, from mood | same |
| Length | 6 | same |
| Seed | 42 | same |
| Check .com | on | on, starts automatically on load |
| Hide registered | **on** | **on**: the feed lists possibly available names only |
| Names per page | 200 | **20** (50 / 200 / 1,000 / 4,000 available) |

Preferences use `bne.preferences.v2`; no old-key migrations run.

## Information architecture

There are three destinations: a bottom tab bar on phones and header tabs on desktop.

1. **Explore**: the feed.
   - **Title** reads from the mood ("Names that feel ● calm ▾"). The mood is a
     pill-shaped chip inside the heading, with its coloured dot and dropdown
     arrow. It opens Tune at Mood; there is no separate configuration bar.
   - **Status line**:
     - one quiet sentence plus a thin progress bar;
     - Pause or Resume appears only when it applies.
   - **Feed**:
     - one row per name: the name, its domain, a status dot and a save heart;
     - tapping a row opens the **name sheet**.
   - **Load more** appends the next page underneath. Pages keep their
     resume/cache semantics; the feed just reads as continuous.
2. **Reverse**: one field, "Type a name you like", then the result.
   - Pronunciation options (reading source, supplied reading) are folded.
   - The result offers follow-ups:
     - **Nearby spellings** (the substitutions tool);
     - **Exact fit** (the inverter);
     - "Explore similar →" for each candidate setting.
3. **Shortlist**: saved names in the same rows, also opening the name sheet.
   Backup and import are two quiet actions under the title. There is an empty state.

### Where every capability lives

| Capability | Home |
| --- | --- |
| Mood, blend and blend amount | Tune › Mood (open by default); the mood chip in the title opens it |
| Energy, weight and novelty dials | Tune › Sound |
| Syllables, opening and ending | Tune › Sound |
| Letters (length) | Tune › Spelling |
| Show registered names, check .com, DNS pre-filter, fresh recheck | Tune › Domains |
| Names per page, start page, seed | Tune › Advanced |
| Lookup tuning (RDAP and DNS slots, rates, timeouts) | Tune › Advanced › Lookup tuning |
| Cache inspect and clear, CSV export, last-search lookup statistics | Tune › Advanced |
| Pagination | Load more (feed); start page (Advanced) |
| Pause and resume | Status line, contextual |
| Pronunciation and sound breakdown | Name sheet › Sound (runs automatically, no dictionary) |
| Inverter ("fit this spelling") | Name sheet › Sound; Reverse › Exact fit |
| Substitutions | Name sheet › Nearby spellings; Reverse › Nearby spellings |
| Copy, open domain, save | Name sheet actions; save is also on every row |
| Shortlist backup and import | Shortlist header |

### Tune

- **Mobile:** a bottom sheet (`<dialog>`, modal).
- **Desktop:** an inline panel that expands above the feed.
- **Sections** are folds, each with its current value on the right:
  Mood (open), Sound, Spelling, Domains, Advanced.
- **Applying:** changes apply on **Show names** or on closing the sheet, never per
  keystroke, so lookups don't restart while you're still adjusting.

### Name sheet

- **Content:**
  - the large name and its domain;
  - the status ("Possibly available — RDAP found no registration; confirm with a
    registrar"), with when it was checked and the source;
  - actions: Save, Copy and Open.
- **Sound:**
  - the inverter runs in the analysis worker from the generator grammar, so no
    dictionary download is needed;
  - it shows phones, syllables, opening and ending, plus the closest dial
    settings, with "Explore similar →".
- **Nearby spellings:** substitution suggestions, computed on request from the
  same phones.

### Shared names and navigation

Explore, Shortlist, Nearby spellings, Reverse's reference and its example names
all use the same row: name, .com status and favourite heart. Clicking the name
area opens the full name sheet; the heart saves directly. Nearby rows add a
change explanation, such as "Same sounds · 1 extra letter". Reverse keeps the
settings groups around its example rows.

Following a nearby name replaces the current sheet. "Back to Goftu" restores
the preceding name, its computed suggestions, scroll and keyboard focus. Close
or Escape returns to the originating list. The last 20 views are retained while
the sheet is open and released when it closes.

Save, Copy, Registry/Visit site, sound details, Explore similar and nearby
suggestions are available from the shared sheet. Registry opens the external
registry website. Only known registered domains use Visit site. Sound analysis
itself is local. Nearby spellings, Reverse's reference/sample names and Shortlist
automatically check .com availability when their lists appear. Rows render first,
then their status updates in place; registered names stay visible in the same
order. Hidden lists do no automatic work until opened. Recent results are reused
for five minutes, including across reloads; older results are rechecked. Offline
lists use cached evidence and retry missing checks after reconnecting. Explore's
automatic-check preference continues to control its own feed.

A small refresh icon beside the status pill checks an unchecked .com or refreshes
an earlier result. Its tooltip/accessibility label changes to Check, Refresh or
Retry. The icon has a 44 px hit area, spins during checking (static with reduced
motion), and prevents repeat clicks. Save still works. Results update every
occurrence without restarting Explore or adding feed rows/counters. Manual and
automatic list checks share the feed's provider limits, take priority, and retry
if a feed change replaces the scheduler. Offline/errors are announced and never
imply availability. Failed
refreshes retain the previous result with its timestamp and a clear failure note.
Text-only references have no check control. Only validated RDAP responses can
establish possible availability.

Reverse references keep the analysed pronunciation, including when saved and
reopened. If it cannot be represented by the generator, the sheet explains why
there are no matching settings and still allows nearby exploration. References
that are not single valid domain labels remain saveable as text without an
invented .com link. Save state and incoming check results update every visible
occurrence of the same name.

"Explore similar →" consistently applies the displayed dials and structure,
selects their nearest mood, and starts a new Explore feed from page 1. This action
is shared by name-sheet Sound, Reverse candidates, and Reverse's Exact fit.

## First screen at 390 px

The first paint is static HTML, before any JavaScript runs:
- the header;
- the title "Names that feel ● calm ▾", with the mood chip as the settings expander;
- "Finding available .com names…";
- three placeholder rows.

The search starts at once. Each row replaces the placeholders as it is confirmed;
nothing visible is pushed around. About eight 68 px rows fit above the bottom tab bar.

## States

| State | Treatment |
| --- | --- |
| Loading | Placeholder rows; quiet shimmer, static under reduced motion |
| Checking | Progress bar; "Checked 132 · 9 available so far"; rows land with a 2 px fade |
| Done | "20 names · possibly available .com"; Load more appears |
| Empty | "No available names on this page" with Load more and a hint to tap the mood above |
| Show-all mode | Registered rows dim, labelled "registered"; unchecked rows "checking…" |
| Offline | Header pill "Offline"; the feed shows unchecked names and resumes automatically when back online |
| Error | Red status sentence with Try again (Resume) |
| Paused | "Paused. Progress is saved." with Resume |

Motion:
- sheets slide up in 240 ms;
- rows and statuses fade 2–4 px;
- the save heart pops;
- all of it is off under `prefers-reduced-motion`.

Every hit area is ≥ 44 px, and fields are 16 px on touch devices so iOS doesn't zoom.

## Visual language

The tone is calm and premium:
- warm white, near-black ink and one semantic green ("available");
- black is the primary action colour;
- generous row height with hairline dividers;
- pill chips;
- sheets with 20 px top corners.

Type:
- Funnel Display carries the names and titles;
- Inter (400 and 600) carries everything else;
- the monospace face is dropped, except system monospace for ARPABET phones and
  the raw report.
