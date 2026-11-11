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
