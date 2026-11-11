# Inventing words from the feelings of sound

Research direction · 11 November 2026 · Exploratory

## What we want to explore

Can we learn a perceptual space of word sounds, then invent words by moving
through that space and combining selected qualities?

The starting intuition is that sounds and their combinations can evoke feelings.
Some associations may be shared across cultures; others may depend on language,
spelling, familiar words, or personal experience. We want to investigate which
properties are shared, extract useful relationships, and use them to guide
new word formation.

A user could start from examples like **anvil, archon, figma, zook, zudio,
feluchi, hissie, or wizzie**. Or they could start directly with a desired
impression: more energetic, less harsh, substantial but still welcoming.

There is value in multiple approaches. We do not need to settle on one generator
or assume that every approach answers the same research question.

## Three complementary approaches

### 1. Start with words and transform their pronunciation

Use a reference word or a collection of words as the starting material. Describe
their pronunciation, syllables, stress, and recurring patterns. Then make
plausible substitutions or structural changes while preserving chosen features.

For example: keep a two-syllable rhythm and the ending, but change the opening
sound; or preserve the general shape while moving toward a different vowel
quality. “Legal” here means permitted by the chosen language or sound grammar,
not universally valid across all languages.

This approach answers: **What other words can have a similar sound structure?**
It can work before we have a reliable model of perceived mood. Similarity in
structure does not, by itself, prove similarity in feeling.

Wuggy is a relevant precedent for template-based pseudoword generation.
UniPseudo is a related route: learn recurring transitions from an example word
list rather than explicitly mutate each reference word. [1][2]

### 2. Start with perceptual dimensions and generate toward a target

Represent desired impressions as coordinates in a multidimensional space.
For a simplified illustration, use two dimensions:

- Restful ↔ energetic
- Gentle ↔ forceful

Set some dimensions high, some low, and leave others unconstrained. Then favor
sounds and combinations that are predicted to evoke that region of the space.
No starting word is required.

The actual dimensions should come from research and listener judgments rather
than being fixed by this illustration. They may overlap or interact; we should
not assume every axis is independent or every combination is achievable.

This approach answers: **Which new words are likely to evoke this combination
of impressions?**

A relevant empirical starting point is *Higher order factors of sound
symbolism*. The study measured 25 phoneme associations and found broader factors
of activity, valence, potency, and novelty. These are candidate foundations to
investigate, not a complete validated control panel for brand names. [3]

### 3. Use examples to locate a target, then transform selected dimensions

Examples can help a user express a target without naming every dimension.
Estimate their perceived qualities, then let the user preserve some and change
others.

For instance: “keep the weight I associate with anvil, use a rhythm closer to
zudio, and move toward the playfulness I associate with wizzie.” These are
user-intended qualities, not established measurements of those names.

This combines perceptual constraints with structural ones. Weight and
playfulness are impressions; rhythm is a property of the word's form. Both
can be useful controls, but they should remain distinguishable.

This approach answers: **How can we preserve what I like while changing a
particular part of the experience?**

## The shared model

All three approaches can share three components:

| Component | Role |
| --- | --- |
| Sound grammar | Defines plausible sound sequences, syllables, stress, and allowed transformations for the target language/style |
| Perceptual model | Estimates the impressions a complete pronunciation is likely to evoke, including uncertainty and audience differences |
| Generation/search | Finds varied candidates that satisfy structural constraints and approach the requested perceptual target |

The model works in two directions:

**Pronunciation → estimated impressions:** locate a word in a fuzzy region of
perceptual space, using listener evidence where available.

**Target impressions → candidate pronunciations:** sample or search for plausible
forms likely to fall in that region. Many different forms may fit the same
request. Spelling can then be chosen and evaluated separately.

We do not assume a dimension directly supplies the laws of pronunciation.
Dimensions guide preferences within a sound grammar. We also do not assume
whole-word impressions equal the sum of individual phoneme scores. Sound order,
neighboring sounds, repetition, rhythm, stress, and endings may all contribute.

Lexifer provides a useful precedent for weighted sounds, word shapes, and rules
for allowed combinations. LEX-ICON provides constructed words and a method for
associating them with multiple semantic dimensions. Its constructed-word labels
are derived from earlier phoneme coefficients; they are not independent human
ratings for every word. [4][5]

## What combining profiles would mean

A profile would be a convenient starting region in perceptual space, potentially
paired with a structural recipe. The current preset names could eventually
become such starting points if evidence supports their intended impressions.

Combining profiles could mean:

- Interpolating between two targets across selected dimensions.
- Taking one dimension from one reference and another from a different reference.
- Holding some qualities approximately steady while increasing or decreasing another.
- Keeping a reference's syllable structure while targeting a different impression.

“Halfway between” is initially a hypothesis about the representation. A midpoint
in coordinates may not feel halfway between two names to listeners. Some targets
may conflict with one another or require a tradeoff with pronounceability.

The desired output is therefore a diverse set of candidates with approximate
fit, not one supposedly correct word. Generation weights should not be presented
as calibrated percentages of emotion.

## What “inherent to sound” means as a research question

We want to test for associations that survive changes in spelling, familiar
word meaning, and language/cultural background. Existing cross-language
bouba/kiki findings make this a reasonable direction, but do not establish
universal meanings for all sounds or profiles. [6]

Several influences must be distinguished:

- Acoustic and articulatory properties of sounds.
- The order and structure in which sounds combine.
- Patterns learned from a particular language.
- Existing word meanings and brand familiarity.
- Spelling and visual appearance.
- Individual taste and cultural experience.

For example, anvil is a familiar object word, while Figma is an established
brand. Their perceived character cannot be attributed entirely to phonetics.
We should confirm the intended pronunciation of reference names rather than
infer it solely from their letters.

## Questions and experiments

1. **Recover useful dimensions.** Gather judgments on novel spoken forms across
   several qualities. Examine which qualities cluster and which remain distinct.
   Compare against established dimensions before inventing a new taxonomy.
2. **Test transformations.** Create controlled variants of reference structures.
   Measure whether a change moves the intended quality while preserving others.
3. **Test combinations.** Compare individual cues with combined cues. Assess
   additive effects, interactions, and conflicts rather than presuming simple
   averaging works.
4. **Compare generation routes.** Evaluate template transformations, example-list
   models, dimension-guided generation, and the current rule-based baseline using
   the same listener tasks.
5. **Test transfer.** Evaluate unseen names and new listeners, then explicitly
   compare language/cultural groups. Separate effects of pronunciation, spelling,
   and familiar meaning with audio and written conditions.

Measure target fit, pronounceability, distinctiveness, and liking separately.
A word can match an impression without being a good brand name. Model-generated
ratings can help explore hypotheses but cannot replace independent listener
validation of the same model's claims.

Domain availability remains a downstream practical filter. Evaluate the sound
model before domain filtering, then examine the available subset separately.
Otherwise availability could silently change which sound patterns we evaluate.

## Current status and next step

The implemented generator uses explicit letter-pattern presets and cached domain
checks. It does not yet learn dimensions, infer profiles from examples, or blend
perceptual targets. This document records directions for research, not a claim
that those features already work or a commitment to one architecture.

A useful first study would compare a small set of example-guided transformations
with dimension-guided candidates for two selected qualities. Confirm reference
pronunciations and intended impressions first; then design controlled candidate
sets and a listener evaluation. Use those observations to decide which approach
to develop further.

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
