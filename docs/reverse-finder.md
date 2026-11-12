# Read a sound, find settings

Reverse is available in the web app and `node dist/cli.mjs reverse WORD`.
It accepts the bundled CMU US-English reading, explicit `--reading she-en`, or
`--phones 'SH IY EH N'`. Engine spelling does not guess silent letters; unsupported
sounds or structures are reported as representation gaps.

The exact inverter, `node dist/cli.mjs invert lemoru`, fits the spelling against
all 1,331 integer dial combinations. It reports likely fits with neutral
regularization, not recovered original author settings.

`node dist/cli.mjs substitute lemoru --reading lemoru --count 5` runs a bounded
phoneme substitution beam. The web app exposes this as Nearby spellings in the
name sheet and Reverse follow-ups. None of these analysis actions makes domain
requests. Availability requires a separate lookup.

Pronunciation notes and alternate readings remain visible. A recipe similarity
is a model score, not evidence that humans perceive a word with that emotion.
