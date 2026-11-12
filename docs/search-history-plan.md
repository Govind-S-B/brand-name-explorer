# Fresh visits, search history and compact navigation

Keep the existing Explore/Reverse/Shortlist navigation in its current location
(top right on desktop, bottom on mobile). Show the selected tab's label and all
three icons, hiding only inactive visible labels while retaining accessible names.
Add quiet History, Settings and GitHub controls in the top app bar; GitHub links
to this repository. Preserve the existing feed, Tune and name-sheet styling.

Fresh page loads choose a random feeling different from the current one, use a
new random integer seed and start at page 1. Apply the new feeling's dials and
clear the previous blend; retain spelling and lookup preferences. The feeling
and seed stay stable through pagination and resume. Settings can disable this
reload shuffle for repeatable visits. Running a
history entry again always uses its saved seed, independently of that preference.

History always records and stores the latest 100 actual searches locally:
timestamp, source/action, all generation/lookup controls, seed, page/count and
Reverse query plus supplied reading when applicable. Pagination is recorded;
provider retries, background domain checks and opening a name are not. Entries
show a compact description and relative time, expand to exact controls/time, can
be filtered by name/mood/seed, and offer Run again with the complete saved
configuration and seed. Opening an entry only shows its details; rerunning it
records a new timestamp.
Do not persist generated name lists or provider responses in this extra store.

Settings has the new-seed preference and Clear history; there is no recording toggle.
History and settings use existing accessible sheets; keyboard/Escape/focus work.
Bound and validate persisted data; tolerate corrupt or unavailable storage.

Sequence: capture current screens; implement/test history model and random seed;
connect search triggers/Run again and lazy history UI; compact existing navigation
and add utilities; verify three reloads, exact reruns, Reverse/custom readings,
pagination, clear/corruption, responsive/keyboard/axe and existing lookup
regressions. Fix deterministic harnesses to explicitly disable random reloads.
Record bundle/load impact, commit, fast-forward main, publish Pages and verify
the live 390 px app and repository link.
