# Reverse finder: the generator's inverse

The inverter fits the actual forward generator. If a reference has properties
that the generator cannot represent, it returns **gap**, lists the missing
capabilities, and returns **no candidate settings for the original**. There is
no partial-sound scoring fallback. Optional substitutions are a separate search
for different words; they do not change the original result.

It runs locally with Python's standard library and a bundled pronunciation
dictionary. No network requests, domain checks, cache writes, or learned models
are involved.

```bash
python3 reverse_finder.py lemoru
python3 reverse_finder.py Zafkiel --reading zaf-ki-el
python3 reverse_finder.py Shien --reading she-en
python3 reverse_finder.py Giorno --reading jee-orn-o
python3 reverse_finder.py valve --json
python3 reverse_finder.py Shien --reading she-en --substitutions 5
```

Exit status is **0** for a fit, **1** for a representation gap, and **2** for an
invalid request or unreadable pronunciation input. JSON output carries `status`,
`source`, `phones`, `structure`, `gaps`, and `candidates`. On a gap, `candidates`
is empty. This makes it possible to collect unsupported cases as research inputs
without mistaking approximate recommendations for successful inversions.
With `--substitutions`, suggestions appear in a separate `substitutions` object;
a gap still exits with status 1 even when suggestions are found.

## Engine, generator, inverter

| Component | Owns |
| --- | --- |
| `sound_engine.py` | Shared sound classes, evidence coefficients, dial weighting, and mappings of intended sounds to ARPABET |
| `sound_profiles.py` / `MoodSpace` | Forward word grammar, structural constraints, exact-length distribution, seeded sampling without replacement |
| `inverter.py` | Representation checks, gap reporting, and fitting against that forward distribution |
| `substitutions.py` | Optional nearby-word search over allowed forward grammar forms, with explicit edit costs |
| `pronunciation.py` | Input readings and their provenance; no mood estimation |
| `name_generator.py` | Forward CLI, pagination, domain checks, and cache integration |
| `reverse_finder.py` | Inverse CLI, readable/JSON reports, and commands for supported references |

These are small modules with explicit responsibilities, not a plugin framework.
The inverter directly calls `MoodSpace` for its likelihood calculations. A future
engine must define both its forward behavior and how references are checked and
inverted; it cannot claim coverage by fitting a different surrogate model.

Extracting the shared weights preserves existing default generation sequences,
capacities, and saved-session identities. No new forward sound rules have been
added to make the stress tests pass.

## Reading sources

The order is explicit pronunciation, dictionary, then spelling assumption:

- **`--phones`** supplies ARPABET sounds directly, such as `"SH IY EH N"`.
  Optional vowel stress digits are retained. Unknown sounds and stress digits on
  consonants are rejected.
- **`--reading` without separators** uses the engine's explicit spelling rules:
  `a=ah`, `e=eh`, `i=ih`, `o=oh`, `u/oo=oo`, `ee=ee`, `ai=ay`; `g` is hard,
  `sh/ch` are single sounds, and the engine's `ng` is n followed by g.
  Extra analysis tokens such as `j` can be read but still flag unsupported sounds.
- **`--reading` with spaces or hyphens** declares syllables. Common one-syllable
  chunks use the first matching dictionary reading, with each choice printed;
  other chunks use engine spelling. Dictionary stress on isolated syllables is
  not transferred to the name. Thus `she-en` becomes `SH IY EH N`, preserving two
  vowel nuclei; `jee-orn-o` becomes `JH IY AO R N OW`, preserving the r–n order.
  `zaf-ki-el` currently assumes `Z AA F K IY EH L`: the fallback `a` is ah, not
  necessarily the vowel the speaker intends. Use `--phones "Z AE F K IY EH L"`
  if the intended first vowel is the one in English “cat.”
- **Dictionary lookup** uses the bundled CMU dictionary when no override is
  supplied. It is primarily US English, not a multilingual pronunciation oracle.
  Alternative entries are displayed, and the first is analysed. Its stress and
  vowel distinctions remain visible rather than being silently erased.
- **Spelling fallback** applies only when a word is absent from the dictionary.
  The report explicitly says this is an assumption, not inferred English
  pronunciation. Doubled letters are not automatically collapsed, and letters
  are not silently dropped. Supply a reading to correct the assumption.

The CMU dictionary's [source, revision, and license](../data/cmudict/README.md)
are included. Its pronunciation vocabulary is broader than the generator's;
recognising an input sound does not imply the generator can produce it.

## Stress-test references

These cases are deliberately left as tests of coverage, not a vocabulary to
imitate or exceptions hardcoded into the generator.

| Reference | Reading source | Result and identified gaps |
| --- | --- | --- |
| Rudolf | CMU, first entry; alternative displayed | Gap: final l–f group and specified stress |
| Zafkiel | Supplied zaf–ki–el, mapped as described above | Gap: internal f–k, adjacent vowel nuclei, explicit syllable boundaries |
| Himmel | CMU | Gap: schwa (AH) and specified stress |
| Fern | CMU | Gap: r-coloured vowel (ER) and specified stress |
| Testarossa | Spelling assumption, unconfirmed | Gap: internal s–s; does not claim an Italian pronunciation |
| Shien | Supplied she–en | Gap: adjacent vowel nuclei and explicit syllable boundaries |
| Valve | CMU | One syllable, closed ending; gap: AE vowel, final l–v, specified stress |
| Figma | Engine spelling assumption, unconfirmed | Fit: energy 4, weight 4, novelty 7; this does not establish that the assumed final vowel matches the user's reading |
| Giorno | Supplied jee–orn–o | Gap: JH and AO sounds, adjacent vowel nuclei, explicit syllable boundaries |

Stress and exact syllable boundary placement are genuine gaps under the strict
contract: today's generator specifies vowel-group count, not those properties.
Consequently a dictionary entry can fail even if its unstressed sound sequence
would otherwise fit. A user may explicitly supply a less specific reading, but
the program does not discard those constraints on their behalf.

Spelling is also part of the contract. If the same pronunciation renders only as
another spelling in the engine, that is an alternate-spelling gap. A supplied
reading clarifies the reference; it is not permission to replace the reference
with a different word or change its character count.

## Optional nearby substitutions

`--substitutions N` requests 1–20 alternative words. Omit it (or use 0) to keep
the strict inverse-only behavior. This search is also available for references
that already fit; the original spelling is excluded from the suggestions.

It searches allowed generator forms near the reference's character length
(±2, within 3–14) and vowel-group count (±1, within 1–5). For an out-of-range
reference, the center is first clamped to those generator limits. Both opening
and ending may change. A bounded beam of 48 prefixes per grammar shape keeps
the search practical. It is deterministic and independent of seed, but is not
guaranteed to find the globally nearest alternatives. The returned report gives
the actual length/count ranges searched.

The sound-edit heuristic costs are:

- Insert or remove a sound: **1**.
- Replace a vowel with another vowel, or a consonant with one in the same broad
  manner group (stops, fricatives, affricates, nasals, liquids, glides): **0.5**.
- Other sound replacement: **1**; identical sounds: **0**.

These are design choices, not measured phonetic or emotional distances. Ties
favor spellings closer to the reference, then smaller character-length changes,
then alphabetical order. Homophonic suggestions are deduplicated so u/oo variants
do not fill the list. The search does not use mood weights to claim perceptual
similarity.

Each suggestion includes the intended sounds, edit operations, structural changes,
and a command to inspect that alternative with its explicit engine pronunciation.
Any supplied stress or exact syllable boundary placement is explicitly relaxed
for suggestions; it remains a gap for the original. The dictionary and spelling
assumptions shown for the reference also apply to the search target.

For `Shien --reading she-en`, the current first three suggestions are **Sheen**,
**Shen**, and **Sheern**, each at sound-edit cost 1. Sheen removes the second vowel;
Shen removes the first; Sheern replaces the second vowel with R. All three change
the vowel-group count from two to one. This illustrates why edit cost is not a
promise to preserve every structural or perceptual quality.

Suggestions are verified against the forward grammar. They are not screened for
dictionary words, brands, or domain availability. Choosing one and analysing its
explicit reading is a new reference, not a successful inversion of the original.

## Fitting a supported reference

The inverter fixes opening, vowel-group count, ending, and spelling length. It
scores all **1,331 integer combinations** of the three 0–10 dials using the
forward generator's normalized first-draw word probability for that structure:

```text
fit = log P(reference | fixed structure, dials)
      - 0.5 × sum(((dial - 5) / 5)²)
```

The neutral-setting penalty limits extreme estimates from one observation. Its
strength is a design choice, not a human-calibrated parameter. The top three
settings may be neighboring grid points rather than distinct moods. The nearest
recipe is chosen by Euclidean distance over dials, with all dials and structure
explicitly overridden in the suggested command.

Near-best ranges cover grid points within 0.1 of the best penalized score. These
are marginal summaries, not confidence intervals, and their endpoints cannot
necessarily be combined arbitrarily. Seed changes sample names, not the fit.

For `lemoru` under its engine reading, the best fit remains energy 1, weight 2,
novelty 3. Returned commands use `--no-check-com`; sample names are unfiltered and
may already be real words or brands.

A successful inverse is not recovery of a unique original configuration or seed.
Many settings can produce the same word. It also does not establish how people
will feel about it: the inverse inherits the forward engine's limited evidence
and heuristics. This is a strict baseline for [research topic 2](research-direction.md),
with gaps showing where forward and inverse capabilities need to grow together.
