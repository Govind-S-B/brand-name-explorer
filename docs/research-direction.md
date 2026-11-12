# Inventing words from the feelings of sound

Research direction · Updated 12 November 2026 · Exploratory

## The thesis

Can we learn a perceptual space of word sounds, then invent words by moving
through that space and combining selected qualities?

Our starting belief is that a good invented name can work across product
categories when the feelings match. It need not describe a product or originate
from industry vocabulary. Sound can supply a character, while the product builds
meaning around it. How far those impressions travel across categories, languages,
and listeners is a research question, not an assumption of universality.

The project has four research topics. These replace the earlier three-approach
outline as the main research agenda. Reference-word transformations and
rule-based generation remain useful methods within it.

| Topic | Main question | Intended result |
| --- | --- | --- |
| 1. Richer expressibility | What finer sound qualities and interactions can we represent? | A richer research-informed vocabulary, rules, and scoring |
| 2. Reverse lookup | Where does an existing word sit, and what settings approximate it? | Word/pronunciation → estimated profile and candidate configurations |
| 3. Learned, mixable generation | Can we encode, blend, steer, and decode those representations? | A learned sound space navigated through dials and reference words |
| 4. Teacher-assisted enrichment | Can an LLM supply useful examples beyond our rule coverage? | Curated synthetic examples and judgments for a smaller model |

We do not currently have capacity for our own listener study. Initial work can
use existing research, rule-generated data, and provisional model annotations.
We will keep agreement with rules, agreement with a teacher model, and agreement
with people distinct.

## 1. Richer expressibility

Expand the current energy, weight, and novelty preferences with finer descriptions
of sound character. Candidate contrasts include sharp–round, hard–soft,
harsh–mellow, abrupt–continuous, and tense–relaxed. These are research candidates,
not a commitment to add a CLI flag for each one.

The useful question is whether we can distinguish combinations such as **light
and mellow** from **light and sharp**, or change texture while approximately
preserving weight. More labels do not automatically mean more independent
controls: several judgments may respond to the same sound features.

LEX-ICON and the underlying Sidhu study provide a starting vocabulary. [3][5]
For constructed words, LEX-ICON averages phoneme-category coefficients from prior
human research and retains sufficiently non-neutral associations. This is a
formula-based extension of earlier findings, not independent human ratings for
all its invented words. Averaging the same phonemes also leaves scores unchanged
when their order changes; it cannot capture all effects of rhythm or sequence.

We want to investigate sound classes, vowels, neighboring sounds, ordering,
repetition, rhythm, and structural constraints. Each proposed relationship should
be identified as empirical evidence, an extrapolation, or a design heuristic.
Phonetic structure and spelling should be distinguished where possible.

**Initial work:** identify finer contrasts supported by available research,
construct controlled examples, and check which differences the current grammar
can actually express. Preserve the current rule-based engine as a baseline.

## 2. Reverse lookup: word → profile/configuration

Start with an existing or invented word and its intended pronunciation. Estimate
its structural properties and sound character, then suggest generator settings
that could produce words with a similar character.

The intended flow is:

**Word + pronunciation → structural description + estimated perceptual profile
→ one or more approximate generator configurations.**

This is an inverse problem, not recovery of a uniquely correct recipe. Multiple
configurations can produce similar impressions, and some words will contain
features our grammar cannot express. The inverter is the inverse of the
generator: if a reference falls outside its support, flag the specific gaps and
return no fitted settings or automatic substitute names. An explicitly requested
substitution search can propose different, representable words, with edits and
relaxed constraints reported separately; the original remains a gap. Do not fit only the supported
sounds while ignoring the rest. Expanding coverage requires expanding the
generator and its corresponding inverse together.

For generated words, we can retain the originating configuration as known
provenance. That does not make it the only configuration capable of producing
the word or establish its perceived mood. For external words, pronunciation may
need clarification before a useful estimate is possible.

**Initial work:** separate properties we can directly extract, such as intended
syllable structure, from impressions we estimate. Use controlled variants to
check whether changes in a word move the estimated profile in sensible ways.
This topic can start with rules and research coefficients; it does not require a
neural encoder at the outset.

## 3. Learned, mixable generation

Learn a higher-dimensional representation of word sounds from the richer
examples and configurations developed in topics 1 and 2. The hypothesis is that
a small neural model can learn useful regularities and a smoother space for
exploration, including combinations absent from its training examples.

It would support two connected abilities:

- **Encode:** word + intended pronunciation → a representation of sound character.
- **Generate:** target representation + variation seed → multiple plausible new words.

The current generator, enriched with more nuance, would supply forward training
pairs: **configuration → generated word**. Topic 2 would supply reverse estimates
for words and their properties. We may need additional paired examples and
controlled transformations to cover gaps in both directions. Model architecture,
representation size, and training objectives remain open research decisions.

### What steering could feel like

Start from a word, a profile, or a defined neutral point. Add reference words or
themes, each with a slider centered on the current baseline. Move a slider left
or right to adjust its influence, then generate candidates near the new target.
Word examples can be encoded into vectors and blended in different ways before
decoding into new words. A theme needs its own mapping into this sound space;
a text embedding of its meaning is not automatically a sound-impression vector.

We want to explore both whole-profile blends and selective mixing: take texture
from one reference, preserve another's rhythm, and adjust energy independently.
The example words mentioned in early discussions were illustrations, not a
training target or a fixed set of anchors.

Two interaction questions need explicit answers:

- Pulling toward a whole word may change several properties together. Pulling
  toward only its texture requires a representation that separates that property.
- Moving away from a reference needs a defined baseline and direction. Away from
  sharp does not automatically mean calm; coordinate midpoints need not feel
  perceptually halfway between two words.

### What the network must demonstrate

Training on synthetic rules can teach their regularities, but supplies no new
independent evidence of perception. A model may inherit the generator's blind
spots, memorize examples, or produce invalid forms between valid training points.
Neural weights do not guarantee compliance with pronunciation constraints; retain
explicit checks for requested structure and the chosen sound grammar.

The central test is useful behavior on **held-out combinations**: qualities or
structures seen separately in training but not together. Compare against direct
rule-based sampling and simple profile interpolation. Evaluate constraint
satisfaction, diversity, similarity to training examples, and target fit
separately, stating whose judgments define target fit.

Topic 3 is successful only if learning provides useful exploration beyond the
simpler baselines, rather than merely recreating their output through a network.

## 4. Teacher-assisted enrichment

Use a stronger LLM as a teacher to add carefully selected examples and judgments
where rules and existing data have poor coverage. The bet is that its learned
associations can provide useful supervision for a smaller model, including themes
that the existing configuration cannot represent.

Possible contributions include:

- Invented-word examples for underrepresented themes or combinations.
- Pairwise judgments about which word is more flowing, heavy, sharp, or otherwise
  closer to a stated target.
- Controlled edits: retain rhythm while reducing abruptness, for example.
- Approximate profiles and explanations for words outside the current grammar.

Few-shot examples can guide the teacher's intended interpretation. Quality,
coverage, and consistency matter more than producing a large volume of similar
synthetic words. An example expressing a new quality is only useful if we also
provide a way to represent that quality; it should not be squeezed into the old
three-dial schema by default.

Record the source, teacher/model version, prompt, example context, and uncertainty
of annotations. Keep generated training material separate from evaluation sets,
and compare teacher-enriched training with rule-only training. Reusing the same
teacher to generate labels and judge success can create circular evidence.

This approach can take on much of the provisional annotation and screening work
while human capacity is limited. Few-shot consistency is not proof of calibration
to listeners, however, and the smaller model may distill the teacher's mistakes
as well as its useful generalizations. Agreement with people remains a separate
validation question for later work or suitable existing human-rated data.

## How the topics connect

**Topic 1 defines what we can express. Topic 2 maps words into that description.
Topic 3 learns to encode, combine, and generate from it. Topic 4 broadens the
training signal beyond what our rules already know.**

Topics 1 and 2 can supply a first dataset for topic 3. Topic 4 can develop alongside
them, revealing missing qualities and contributing examples for both forward and
reverse mappings. This is a research agenda, not four promised implementation
milestones or an instruction to add more controls immediately.

## Boundaries and current status

The implemented CLI offers experimental mood recipes, energy/weight/novelty
preferences, numeric recipe blending, opening/syllable/ending constraints, exact
character length, seeded generation, and cached domain checks. See the
[control hierarchy](control-hierarchy.md) and [sound-dial implementation notes](sound-dials.md).
Current blending interpolates recipe settings; it is not learned vector mixing.
A local [reverse-finder prototype](reverse-finder.md) now fits candidate dial
configurations only for references the generator can represent, and reports gaps
otherwise. Supplied readings, an offline dictionary, and labelled spelling
assumptions are separate input adapters. It is a rule-based inverse baseline,
not a validated perceptual estimator.
Neural encoding/generation, reference-word sliders, and teacher training pipelines
are not implemented.

Existing meanings, brand familiarity, spelling, language experience, and
pronunciation can all influence impressions. We should not attribute every
association to sound or assume it transfers across cultures. Cross-language
bouba/kiki evidence supports investigating shared associations, not universal
mappings for every proposed quality. [6]

Domain lookup, filtering, and pagination remain separate from sound design.
Evaluate generated sound candidates before availability filtering so that domain
registration does not silently select which patterns count as successful.

Related projects provide complementary methods: Wuggy for structural matching,
UniPseudo for transitions learned from word lists, Lexifer for explicit sound
rules, and LEX-ICON for sound–meaning evaluation. [1][2][4][5] The sources below
provide the current reference points; these research leads are not runtime
dependencies.

## Starting references and projects

Sources were inspected on 11 November 2026. Research findings and project
capabilities are starting evidence; the proposed generator has not been
validated by these sources.

1. **Wuggy:** [project](https://github.com/WuggyCode/wuggy),
   [paper](https://doi.org/10.3758/BRM.42.3.627). Template-based pseudoword generation.
2. **UniPseudo:** [paper](https://doi.org/10.1177/17470218231164373),
   [Go implementation and original-tool links](https://github.com/chrplr/unipseudo-go).
   Generation using transitions learned from an input word list.
3. **Sidhu, Vigliocco & Pexman (2022), Higher order factors of sound symbolism:**
   [paper and abstract](https://discovery.ucl.ac.uk/id/eprint/10147434/),
   [data, audio stimuli, and analysis materials](https://osf.io/gruqs/).
4. **Lexifer:** [implementation](https://github.com/bbrk24/lexifer-ts),
   [sound and word-shape rules](https://github.com/bbrk24/lexifer-ts/blob/master/docs/grammar.md).
5. **LEX-ICON / Do Language Models Associate Sound with Meaning?:**
   [code and data](https://github.com/jjhsnail0822/sound-symbolism),
   [paper](https://arxiv.org/abs/2511.10045).
   Relevant methods and sample data were inspected; experiments were not reproduced.
6. **The bouba/kiki effect is robust across cultures and writing systems:**
   [study](https://doi.org/10.1098/rstb.2020.0390).
   Supports investigating shared associations without assuming every dimension is universal.
