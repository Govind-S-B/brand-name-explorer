# What goes in, what comes out

Several projects help invent words, but they give you different starting points.
Concrete examples make those differences easier to see.

| Project | What you choose |
| --- | --- |
| Wuggy | An existing word whose structure you want to match |
| UniPseudo | A word list whose recurring sequences you want to learn |
| Lexifer | The sounds and rules for combining them |
| LEX-ICON | Words and perceptual contrasts to study; this is a dataset and evaluation project |
| Brand Name Explorer | A starting mood, adjustable sound preferences, and structural constraints |

The examples below were collected on 11 November 2026. Wuggy's examples are
published outputs; UniPseudo, Lexifer, and our examples were run locally.
LEX-ICON's examples are stored dataset labels, not generated names or fresh model
answers. This is a practical comparison, not a quality benchmark.

## Wuggy: “Give me alternatives shaped like this word”

[Wuggy](https://github.com/WuggyCode/wuggy) generates pseudowords matched to
properties of an input word, including its subsyllabic structure and transition
frequencies.

These are published default-setting examples from the Wuggy page shown during
our comparison:

| Input word | Output pseudowords |
| --- | --- |
| car | cas, cag, har, rar, dar |
| park | paze, paft, palt, parn, paff |
| border | bowper, bowmer, curder, besder, berber |
| patrol | pagril, pabril, pachil, pablyl, paplil |

The resemblance to the starting word is visible. This is useful when you can say
“something shaped like this,” without specifying a mood.

See the [Wuggy documentation](https://wuggycode.github.io/wuggy/). We did not run
Wuggy for these examples.

## UniPseudo: “Learn patterns from this list and make more”

[UniPseudo's Go implementation](https://github.com/chrplr/unipseudo-go) chains
three-character sequences learned from a supplied word list.

We ran its source with the repository's English word list:

```bash
go run pseudoword_generator.go \
  -f english.word.list.subtlexus4.txt -n 5 -l 6
```

| Input | Actual output from this run |
| --- | --- |
| English word list; length 6; generate 5 | sinust, groado, emphod, trumin, rewser |

There is no individual source word to preserve: it recombines sequences learned
from the list. A different list changes the patterns it can draw on. The run is
randomized, so rerunning this command need not produce these same words.

## Lexifer: “Use these sounds in this pattern”

[Lexifer](https://github.com/bbrk24/lexifer-ts) accepts a definition of sound
classes, word shapes, weights, and transformation or rejection rules.

We ran these two definitions, asking for five words each. `:1` gives each sound
equal weight within its class; `CVCV` means consonant–vowel–consonant–vowel.

| Input definition | Actual output from this run |
| --- | --- |
| `C = m:1 n:1 l:1` / `V = a:1 o:1` / `words: CVCV` | lomo, lano, mano, momo, lalo |
| `C = k:1 t:1 p:1` / `V = i:1 e:1` / `words: CVCV` | kipe, peke, kiki, titi, pipe |

For example, using the JavaScript package:

```javascript
const lexifer = require('lexifer');

const definition = `C = m:1 n:1 l:1
V = a:1 o:1
words: CVCV`;

console.log(lexifer(definition, 5, false, true, true));
```

You choose the ingredients yourself. Changing the inventory changes the character
of the results without changing the word shape. These runs were randomized;
the outputs are samples, not fixed fixtures.

See the [definition syntax](https://github.com/bbrk24/lexifer-ts/blob/master/docs/grammar.md).

## LEX-ICON: “What qualities are associated with this sound?”

[LEX-ICON](https://github.com/jjhsnail0822/sound-symbolism) is a dataset and
evaluation project studying whether language models associate sounds with meaning.
It includes natural and constructed words, with experiments using text, phonetic
transcriptions, and audio.

These are actual entries from its
[constructed-word dataset](https://github.com/jjhsnail0822/sound-symbolism/blob/main/data/processed/art/semantic_dimension/semantic_dimension_binary_gt.json):

| Word | Selected stored labels |
| --- | --- |
| lee-lay | small, light, soft, calming, round |
| lee-lah | small, light, soft, calming, round, slow |

For example, an evaluation can present a word with a contrast such as
**sharp versus round**, then compare a model's choice with the dataset label.

The constructed-word labels are derived from phoneme coefficients from earlier
research. They are not independent human ratings for every word, and the table
above is not a report of model predictions. We inspected the data rather than
running the model experiments.

This project is relevant to the perceptual model we want to investigate: the
connection between a sound form and the qualities people associate with it.

## Brand Name Explorer: “Start with this character, then let me adjust it”

Our generator starts from a mood recipe and lets you override perceptual
preferences and structural constraints. These are the first five outputs for
each mood, with **length 6, seed 42, and domain checks off**, without cherry-picking:

| Input mood | Actual output |
| --- | --- |
| calm | Lemoru, Ralmoo, Moohee, Wawoma, Maluru |
| bold | Vepait, Viveek, Choold, Eedast, Peskez |
| playful | Levihi, Shashi, Feeche, Tatize, Zenisi |

```bash
python3 name_generator.py --mood calm --length 6 --seed 42 --no-check-com --count 5
python3 name_generator.py --mood bold --length 6 --seed 42 --no-check-com --count 5
python3 name_generator.py --mood playful --length 6 --seed 42 --no-check-com --count 5
```

These mood recipes change several settings together, including ending; this is
not a controlled comparison of one perceptual dial. See the
[control hierarchy](control-hierarchy.md) for an example that overrides individual
properties while retaining the rest of a mood's defaults.

Our direction connects **controllable word generation**, as in Lexifer, with
**research about perceived sound qualities**, as explored by LEX-ICON and the
sound-symbolism studies. You choose an impression; the current engine translates
it into sampling preferences inside a sound grammar. Domain availability is a
separate downstream filter.

The current generator does not learn from an input word list, transform a
reference word, or infer its mood. Those are complementary directions described
in the [research direction](research-direction.md).

These examples show what the tools produce. Whether listeners reliably perceive
our intended moods remains a question to test, not a result established by the
names themselves.

## Other work in the brand-name generation space

Two related projects use LLM skills to guide a broader naming process. They are
instruction sets for an agent, rather than standalone sound generators. We
reviewed their documented workflows on 11 November 2026; we have not run either
skill or evaluated the quality of its results.

### Namer

[namer](https://github.com/jbold/namer) starts with a business brief: domain,
vision, advantage, gaps, and the message or feeling the name should communicate.
It extracts seed words and a target sound profile, instructs the LLM to generate
150–200 candidates, then evaluates and searches for existing uses before
presenting ten finalists with rationale and sound notes.

Its generation methods include cultural roots, mythology, morpheme blends,
compounds, industry vocabulary, and **pure sound-symbolic inventions**. Its
[generation instructions](https://github.com/jbold/namer/blob/main/SKILL.md)
explicitly describe the latter as “Not derived from real words — pure phonetic
design.” It therefore overlaps with our direction; it would be inaccurate to
describe it as only a meaning-based name generator.

The difference is how central sound exploration is to the product:

| Question | Namer | Brand Name Explorer |
| --- | --- | --- |
| Where does it start? | A business brief and intended message | A desired impression and sound constraints |
| What role does sound play? | One generation route and evaluation criterion among several | The central material of generation |
| How are candidates produced? | An LLM interprets the brief, references, and instructions | Explicit grammar and weighted sampling |
| How do you explore? | Discuss the brief and refine a shortlist | Adjust dials or constraints and browse a seeded sequence |
| What defines fit? | Business strategy, sound profile, accessibility, and competition | Initially, the intended sound impression; broader brand fit can follow |

Namer's [sound-symbolism reference](https://github.com/jbold/namer/blob/main/references/sound-symbolism.md)
includes confident mappings such as “B” to reliability, “H” to honesty, and
“V + front vowel” to “cutting-edge.” It names research sources, but does not
provide evidence for each individual mapping. Some entries mix written letters,
phonetic properties, and associations with existing brands. These are useful
creative prompts to examine, rather than established coefficients we should
copy into our generator.

Our intended distinction is to make sound-to-impression mappings explicit and
testable. Our current mood recipes and several generation choices are also
heuristics; explicit controls do not make them scientifically validated.

### Naming-process

[naming-process](https://github.com/vicnog/naming-process) describes a longer,
multi-session naming engagement. It moves from an intake and brief through
audience and competitor research, strategic directions, concepts, name
generation, scoring, availability screening, finalists, and a period of trying
the names before deciding.

Its instructions aim for hundreds of candidates and three to five finalists.
The emphasis is on making and evaluating a naming decision in context, with the
user choosing strategic directions and the final name. Sound symbolism is part
of that broader process, rather than an independently adjustable generation
space.

### Our take: feelings can travel across product categories

The starting belief behind this project is that **a good invented name can work
across different product categories when the feelings match**. A name need not
describe the product, contain a relevant root, or originate from industry
vocabulary. Its sound can supply the desired character, while the product builds
meaning around it.

This is a research thesis, not a claim that every name works everywhere. We want
to investigate how well an impression survives changes in product category,
listener, language, and spelling. The examples that inspired the project are not
a target vocabulary or a list of names to imitate.

The LLM naming skills put more emphasis on a structured business brief and
strategic or semantic associations. Namer also explicitly supports invented,
non-descriptive names, so the divergence is one of emphasis and scope: it includes
phonetic invention as one technique; we want to explore the controllable
relationship between sounds, perceived qualities, and new words in depth.

These approaches could complement each other. A future workflow could use an
LLM to interpret a brief and propose sound settings, our generator to produce
candidates, and a broader naming process to evaluate associations and commercial
fit. That integration is not currently implemented, and an LLM's judgment would
not replace listener validation of the intended feelings.
