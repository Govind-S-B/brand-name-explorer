# Sound dials: evidence, decisions, and implementation

11 November 2026 · Experimental implementation, not a validated emotion model

## Research decision

Use **energy**, **weight**, and **novelty** as the first perceptual controls.
Add **syllable count** and **ending** as independent structural controls. Provide
named moods as editable starting recipes, not discrete psychological categories.

The reference words mentioned during discussion were illustrative, not a training
set, target list, or basis for the dial definitions. No model was fitted to them.
The research direction is to invent words from sound impressions, with example
transformation remaining a separate potential approach.

## What was studied

The closest empirical foundation is Sidhu, Vigliocco & Pexman's *Higher order
factors of sound symbolism* (2022). For this implementation we inspected the
accepted manuscript, supplementary material, and shared R analysis source,
rather than relying only on its abstract. [1][2]

Experiment 1 recruited 104 English-fluent University of Calgary undergraduates;
the paper reports removing 19 participants during cleaning. Participants rated
40 CVCV nonwords across 25 semantic dimensions. Consonants came from five
classes: sonorants, voiced/voiceless fricatives, and voiced/voiceless stops.
Vowels contrasted two front vowels with two back vowels. The stimuli used two
different consonants from the same class, and two different vowels from the same
group. List A and List B differed in recording speaker and collection setting.

The authors extracted four broader factors: **activity, valence, potency, and
novelty**. Their factors were correlated: activity and potency correlated .50
in the reported factor solution. Sliders therefore should not promise fully
independent perceptual effects. The authors reported clearer phoneme-category
relationships with activity, potency, and novelty than with valence.

Table 2 reports modest marginal R-squared values for sound-class predictors:
.110 for exciting–calming, .069 for heavy–light, .030 for ordinary–unique, and
.141 for sharp–round. The paper cautions that these mixed-model quantities are
approximations, not exact percentages of explained variance. This supports
useful biases, not confident predictions for individual names.

### The three implemented dials

| CLI dial | Low | High | Research connection |
| --- | --- | --- | --- |
| `--energy` | Restful | Energetic | Activity: fast/slow, exciting/calming, passive/active, and related dimensions |
| `--weight` | Light/delicate | Heavy/substantial | Potency: big/small, heavy/light, strong/weak, and related dimensions |
| `--novelty` | Familiar-sounding | Unusual/buzzy | Novelty: ordinary/unique, realistic/fantastical, simple/complex |

Each accepts **0–10**, including decimals. **5 means no directional sampling bias
from that dial**. It is not a prediction that listeners would rate the word 5/10.
Novelty concerns an experimental sound preference; it does not measure dictionary
rarity, originality, domain availability, or trademark distinctiveness.

The following consonant-category contrasts are reported in the manuscript's
factor analysis discussion, pp. 33–34. We use them as directional sampling
priors. Zero means no directional preference implemented for that cell; it is
not proof that the true effect is zero.

| Category | Energy/activity | Weight/potency | Novelty |
| --- | ---: | ---: | ---: |
| Sonorants | −0.60 | −0.49 | −0.26 |
| Voiced fricatives | +0.39 | +0.28 | +0.40 |
| Voiceless fricatives | 0 | −0.26 | 0 |
| Voiceless stops | +0.36 | +0.23 | 0 |
| Voiced stops | 0 | +0.24 | −0.17 |

Front vowels were associated with higher activity and lower potency in that
experiment. The implementation uses this direction, not its regression
coefficient as a calibrated generator probability.

We deliberately did not expose a “beauty,” “likability,” “trustworthiness,” or
“luxury” dial. Those would overstate what this small model can control. Sharpness
and softness load substantially on activity in this study, so they are not
presented as additional independent dials in this first version.

### Why the grammar goes beyond the experiment

The original study used same-category CVCV words. Our generator mixes categories,
allows repeated sounds, and adds variable syllable structures, clusters, endings,
and spellings. Those are engineering and naming hypotheses, not experimentally
verified extensions of the factor model.

Argo, Popa & Smith report that spoken repetition can influence brand evaluations,
with moderators. That supports making repetition possible, not assuming every
repeated sound improves a name. [3]

The cross-cultural bouba/kiki study provides evidence for broad sound–shape
correspondences across languages, but does not validate these three dials, their
weights, or every generated name across cultures. [4]

## Controls and recipes

| Mood | Energy | Weight | Novelty | Ending |
| --- | ---: | ---: | ---: | --- |
| calm | 1 | 3 | 2 | open |
| airy | 3 | 0 | 3 | open |
| grounded | 2 | 9 | 2 | closed |
| bold | 9 | 9 | 4 | closed |
| playful | 8 | 2 | 7 | open |
| lyrical | 3 | 4 | 4 | open |
| strange | 6 | 5 | 10 | either |

These values and labels are design proposals. They are not clusters extracted
from a listener dataset. For example, grounded combines low activity with high
potency; the model may have to compromise because the dimensions are correlated.

Apply controls in this order:

1. Choose the base mood, default `calm`.
2. Optionally blend its three dial values with another mood.
3. Override any individual dials.
4. Set length, optional syllables, and optional ending.
5. Choose seed, then domain lookup/filter behavior, then count and page.

`--blend playful:0.3` interpolates the numeric recipe values: 70% base recipe,
30% playful recipe. It retains the base ending unless `--ending` overrides it.
This is a blend of **sampling settings**, not proof that human impressions blend
linearly. An equivalent final configuration produces the same sequence, regardless
of which preset labels were used to reach it.

### Structure and pronunciation

- `--length 3..14` is an exact ASCII character count; default 6.
- `--syllables 1..5` selects vowel groups in the grammar. Automatic mode prefers
  simple alternating forms suited to the requested length.
- `--ending open|closed|either` controls whether the spelling ends in a vowel or
  consonant; its default comes from the mood.
- Sounds can repeat. Different sounds are not mandatory.
- The grammar uses onsets, middle consonant runs, vowel nuclei, and codas. Its
  allowed clusters are explicit rather than arbitrary character combinations.

Approximate intended vowel readings are a=ah, e=eh, i=ih, o=oh, u=oo, ee=ee,
oo=oo, ai=ay. The ch and sh spellings are treated as individual consonants.
English readers may pronounce these spellings differently. Thus syllables count
**intended grammar nuclei**, not guaranteed spoken syllables. The program does
not perform speech synthesis or validate pronunciation with listeners.

The mappings for r/w, h, ch, the e/i/u spellings, and mixed clusters extend beyond
the original experiment. Specifically, r/w inherit sonorant preferences, h
inherits voiceless-fricative preferences, and ch approximates voiceless-stop
preferences. Treat these as explicit heuristics, not measured per-phoneme effects.
Letter digraphs and language-specific readings will need a richer pronunciation
representation in a future version.

## How the generator uses the evidence

It centers each dial around 5, scales the reported class contrasts, and combines
the resulting preferences into positive sound weights using an exponential.
Consonant clusters use the mean of their constituent sound preferences and an
additional hand-chosen frequency penalty; higher novelty relaxes that penalty.
Vowels receive a front/back preference from energy and weight. Shape priors favor
simple structures, while exact-length constraints remain mandatory.

The strength multipliers, normalization, cluster penalty, structure priors, and
recipe values are engineering choices. No listener data were used to tune these
numbers, and they must not be described as an empirically fitted generator.

The engine calculates valid completion counts and weight sums by dynamic
programming. It then draws whole spellings **without replacement**, subtracting
each selected spelling's weight from the relevant prefixes. This produces a
finite, deterministic weighted ordering without enumerating every candidate
up front or relying on collision-retry loops.

Every spelling has one decomposition into alternating consonant/vowel runs in
this grammar. That allows an exact capacity and no repeated spellings within a
sequence. Different spellings may still be homophones. Near numerical exhaustion,
a small floating-point floor preserves access to remaining candidates; this can
slightly perturb the intended weighting, while integer counts preserve uniqueness.

The sequence depends on effective dials, length, syllables, ending, grammar
version, and seed. Count and filtering do not change generation. A changed
configuration gets separate browsing progress. Equivalent effective settings
share a session, and the global domain cache remains shared.

Early pages carry the strongest sampling preferences. Very late pages necessarily
include less-favored candidates as preferred combinations are used up. Replaying
later pages takes time and memory proportional to the visited prefix; the engine
does not precompute or look up the whole space by default.

## Verification and remaining research

Automated checks cover exact character lengths, all mood presets, complete
exhaustion of small spaces, unique pages, page-size independence, seed behavior,
invalid controls, blending, cache sharing, session separation, and failure/resume.
Distribution checks verify that changing a dial shifts observable sound-class
or vowel frequencies in the intended direction while other settings are fixed.
These checks test software behavior, not perceived mood.

The next research task is independent listener evaluation of novel outputs:
compare dial endpoints and combinations, measure intended impressions separately
from liking/pronounceability, and use fresh listeners and words for validation.
Test language/cultural groups explicitly. Keep domain availability filtering
separate from the initial perceptual study.

## Sources and tools inspected

1. Sidhu, Vigliocco & Pexman (2022), **Higher order factors of sound symbolism**.
   [UCL manuscript](https://discovery.ucl.ac.uk/id/eprint/10147434/),
   [DOI](https://doi.org/10.1016/j.jml.2022.104323).
   Methods, factor loadings, correlations, category results, and discussion inspected.
2. [Open study materials](https://osf.io/gruqs/).
   Supplementary analyses and shared R analysis source inspected. Analysis not rerun.
3. Argo, Popa & Smith (2010), **The Sound of Brands**.
   [DOI](https://doi.org/10.1509/jmkg.74.4.097). Publisher-supplied abstract inspected.
4. **The bouba/kiki effect is robust across cultures and writing systems**.
   [DOI](https://doi.org/10.1098/rstb.2020.0390). Publisher-supplied abstract inspected.
5. [LEX-ICON](https://github.com/jjhsnail0822/sound-symbolism),
   [paper](https://arxiv.org/abs/2511.10045).
   Its constructed-word scoring inspired inspection of the original study. Its
   generated labels are not independent validation of the same coefficient model.
   No LEX-ICON code or data is bundled in this repo.
6. [Lexifer grammar documentation](https://github.com/bbrk24/lexifer-ts/blob/master/docs/grammar.md)
   and [Wuggy](https://github.com/WuggyCode/wuggy).
   Relevant precedents for weighted rules and structural pseudoword generation;
   their code is not incorporated into this implementation.

All accessed 11 November 2026. The generator uses a small set of attributed
reported numeric findings and original implementation code; its broader
hypotheses are explicitly separated from those findings above.
