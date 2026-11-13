# Read a sound, find settings

Reverse is available in the web app and `node dist/cli.mjs reverse WORD`.
It accepts the bundled CMU US-English reading, explicit `--reading she-en`, or
`--phones 'SH IY EH N'`. Engine spelling does not guess silent letters; unsupported
sounds or structures are reported as representation gaps.

The exact inverter, `node dist/cli.mjs invert lemoru`, first ranks the seven
moods by how probable the spelling is under each recipe, then fits all 1,331
integer dial combinations within the best mood, regularized toward that mood's
own dials. It reports likely fits, not recovered original author settings. The
name must be spellable by the generator grammar; a final silent `e` or a sound
outside the inventory is reported instead of being fitted.

`node dist/cli.mjs substitute lemoru --reading lemoru --count 5` runs a bounded
phoneme substitution beam. Equal-sounding spellings (`Goftu`, `Goftoo`) are
listed at most twice per sound sequence, closest and most familiar first. The
web app exposes this as Nearby spellings in the name sheet and Reverse follow-ups. None of these analysis actions makes domain
requests. Availability requires a separate lookup.

Pronunciation notes and alternate readings remain visible. A recipe similarity
is a model score, not evidence that humans perceive a word with that emotion.
