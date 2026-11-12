# Control hierarchy

The controls answer four sound-design questions, followed by separate controls
for reproducibility, availability, and browsing. Mood supplies a starting recipe;
explicit settings override only the property they name.

## 1. Mood: where to start

`--mood calm` chooses defaults for energy, weight, novelty, and ending. Available
recipes are calm, airy, grounded, bold, playful, lyrical, and strange.

`--blend playful:0.3` mixes 30% of playful's dial settings into the base recipe.
It retains the base mood's structural defaults. This is interpolation between
sampling settings, not a measured percentage of emotion.

Mood is a convenience preset. An explicit energy value does not reset weight,
novelty, or ending. Opening, automatic syllable selection, and length currently
have shared base defaults rather than separate defaults for every mood.

## 2. Perceptual dials: what qualities to favor

| Control | Low (0) | High (10) |
| --- | --- | --- |
| `--energy` | Restful | Energetic |
| `--weight` | Light / delicate | Heavy / substantial |
| `--novelty` | Familiar-sounding | Unusual / buzzy |

Five means no directional sampling preference from that dial. Explicit values
replace the corresponding mood/blend values. These are soft preferences:
changing energy influences which permitted sounds are favored, not which
opening or ending is mandatory.

The dials can be set independently, but their perceived effects are not guaranteed
to be independent. The underlying research found correlated factors, and shared
sound features can affect several judgments at once. See [the evidence and
implementation notes](sound-dials.md).

## 3. Sound structure: what shapes are allowed

### Opening

`--opening` accepts:

| Value | Requirement |
| --- | --- |
| `vowel` | Start with a vowel nucleus, with no initial consonant |
| `consonant` | Start with one consonant sound |
| `cluster` | Start with a permitted sequence of multiple consonant sounds |
| `any` | Do not restrict the opening; this is the default |

A single consonant **sound** may use multiple letters: sh and ch count as single
consonants in this grammar. Br and st are clusters. A consonant opening restricts
only the beginning; internal or final clusters can still occur.

Any means unrestricted, not equal probability across all opening types. It keeps
the existing starting-shape preferences. Choosing a vowel opening works with any
energy setting; energy still acts on vowel selection and later consonants.

### Syllables and ending

- `--syllables 1..5` selects intended vowel groups. If omitted, the grammar uses
  an automatic preference informed by character length and ending.
- `--ending open` requires a vowel ending; `closed` requires a consonant ending;
  `either` permits both. If omitted, the base mood supplies this setting.

An explicit structural choice is a constraint. It is never relaxed just because
a perceptual preference favors something else.

### Structural properties that remain internal

| Property | Current behavior | Why it has no separate flag yet |
| --- | --- | --- |
| Clusters | Fixed permitted inventories; frequency includes a novelty-dependent heuristic | A useful future control needs clear scope: initial, internal, final, or all. Opening already controls the initial case. |
| Repetition | Sounds and syllables may recur | Sound recurrence, syllable reduplication, and doubled spelling are distinct concepts; one generic repetition switch would conflate them. |
| Stress | Not assigned | The generator needs an explicit pronunciation/stress representation before it can honestly promise stressed syllables. |

This is not complete structural independence: novelty currently also influences
cluster preference. That is documented as a design heuristic, not a research
coefficient. The opening constraint takes priority at the beginning. The existing
heuristic is retained in this cleanup to avoid changing all default sequences.

## 4. Spelling constraints: how the word is written

`--length 3..14` gives an exact ASCII character count; the default is 6. It counts
letters, not sounds or syllables. Sh uses two characters while representing one
consonant in our grammar. Vowel digraphs also affect the character budget.

There is no spelling-variant control. The current engine stores intended sound
choices together with their spellings. A future feature that renders several
spellings of the same pronunciation needs those representations separated first.
The existence of u and oo in today's inventory does not constitute that feature.

Structure and length are solved together. We do not generate a pronunciation and
then trim it to fit the character limit. If the combination is impossible, the
CLI reports the requested constraints and asks you to relax one; it does not
silently change syllables, opening, or ending.

## Example: energetic, vowel-opening words

```bash
node dist/cli.mjs \
  --mood calm \
  --energy 8 \
  --opening vowel --syllables 3 --ending open \
  --length 7 \
  --seed 42 \
  --no-check-com \
  --count 20 --page 1
```

This resolves to:

| Layer | Effective choice | Source |
| --- | --- | --- |
| Mood | calm | Explicit recipe |
| Energy | 8 | Explicit override |
| Weight | 3 | Calm default |
| Novelty | 2 | Calm default |
| Opening | vowel | Explicit constraint |
| Syllables | 3 intended vowel groups | Explicit constraint |
| Ending | open | Explicit constraint |
| Character length | 7 | Explicit constraint |

The current seed-42 output begins **Ashedai, Eheshoo, Echifai**. These are generated
spellings under an intended reading; different readers may pronounce them
differently. This example skips domain checks.

Append `--explain` to inspect resolved values and their sources without generating
names or making lookups. Use `--help` to see the same control hierarchy.

## Run controls are separate

- **Reproducibility:** `--seed` chooses the repeatable sequence under the resolved
  sound settings. It does not describe a mood.
- **Lookup and cache:** `--check-com` / `--no-check-com`, `--cache`, and `--refresh`
  decide how registration information is obtained. `--lookup-workers` and
  `--lookup-rate` control concurrency and the shared request-rate ceiling;
  they do not change the generated sequence. See [lookup performance](domain-lookup.md).
- **Availability filtering:** `--hide-registered` / `--no-hide-registered` decide
  whether registered domains appear. No lookup bypasses this filter too.
- **Pagination:** `--count` and `--page` slice the chosen results; they do not alter
  sound generation.

The default remains calm, length 6, seed 42, checking .com, hiding registered
domains, 200 results, page 1. Opening defaults to any. A forced opening gets its
own saved browsing progress while reusing the shared domain cache. Omitting the
opening option, or explicitly choosing any, preserves existing mood sequences
and session identities.

The resolution order is **base defaults → mood → optional dial blend → explicit
overrides → compatibility check → generation**. This is a hierarchy of meaning
and precedence, not a requirement to type flags in that order. Examples follow
the hierarchy so they are easier to read. The sound engine is shared by the browser and Node CLI.

## Research review behind this cleanup

The follow-up investigation supports exposing precise structural choices without
inventing a new emotional meaning for every knob.

**Initial sounds are worth separating from written letters.** *The sound of
branding: An analysis of the initial phonemes of popular brand names* compares
initial sounds in brand-name lists with dictionary words, a contemporary English
corpus, and popular children's names. Its abstract specifically explains why
letter counts can mislead: C has different sounds in Cartier and Cisco. The
analysis is observational; overrepresentation in successful brand lists does not
show that choosing a particular opening causes commercial success. The practical
lesson here is to define opening categories in sound terms. [1]

**Sound order may matter, but the direction is not a universal rule.**
*Sequential Approach-Avoidance Movements* reports affective differences for
ordered articulation sequences across experiments. However, the supplementary
analysis discussed in *Higher order factors of sound symbolism* found no
significant prediction of its valence dimensions from direction of articulation
(p values above .38). These differ in design and are not a direct replication
comparison. Together they justify studying order while avoiding an automatic
“pleasant articulation” switch. [2][3]

**Repetition has evidence, with conditions.** *The Sound of Brands* reports
positive-affect and evaluation effects for spoken sound repetition, moderated by
repetition sensitivity, opportunity to experience emotion, and deviation from
linguistic expectations. That does not establish an optimal repetition rate or
make doubled letters equivalent to repeated syllables. The current allowance for
repetition is reasonable; a new flag needs a more precise behavioral definition. [4]

**Stress is a meaningful research variable, but implementation support matters.**
*Is Nestlé a Lady? The Feminine Brand Name Advantage* discusses name length,
sounds, and stress as cues to linguistic gender, with warmth and brand outcomes
in its studies. This is not evidence that our spelling-only generator can control
stress or that one stress pattern universally produces warmth. It supports
keeping stress on the research roadmap and testing intended pronunciations. [5]

**A restricted phonotactic model is still an approximation.** Wuggy demonstrates
language-conditioned structural generation and transition constraints. Our small
handwritten inventory is useful for exploration but is not a complete model of
English or a cross-cultural pronunciation guarantee. [6]

The resulting change is deliberately focused: add opening, organize the existing
controls, make defaults/overrides inspectable, and document the remaining gaps.
No new mood categories or research coefficients were introduced in this cleanup.

### Sources and reading scope

Reviewed 11 November 2026. Publisher abstracts were read where full text was not
available; these findings are not a systematic review or a replication audit.

1. *The sound of branding: An analysis of the initial phonemes of popular brand
   names*, published online 2019. [Publisher page](https://doi.org/10.1057/s41262-019-00183-5).
   Publisher abstract and relevant page context inspected.
2. *Sequential Approach-Avoidance Movements* (2016).
   [DOI](https://doi.org/10.1027/1864-9335/a000263).
   Publisher-supplied Crossref abstract inspected.
3. Sidhu, Vigliocco & Pexman (2022), *Higher order factors of sound symbolism*.
   [Manuscript](https://discovery.ucl.ac.uk/id/eprint/10147434/).
   Previously retrieved full text revisited, including the discussion and footnote
   on articulation direction, pp. 50–51 of the accepted manuscript.
4. Argo, Popa & Smith (2010), *The Sound of Brands*.
   [DOI](https://doi.org/10.1509/jmkg.74.4.097). Publisher-supplied abstract inspected.
5. *Is Nestlé a Lady? The Feminine Brand Name Advantage* (2021).
   [DOI](https://doi.org/10.1177/0022242921993060).
   Previously retrieved publisher-supplied abstract used for the limited claim above.
6. [Wuggy documentation](https://wuggycode.github.io/wuggy/).
   Previously retrieved documentation revisited; its generator was not run here.
