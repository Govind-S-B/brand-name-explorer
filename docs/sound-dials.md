# Sound engine: evidence, decisions, and implementation

13 November 2026 · Engine v2 · Experimental, not a validated emotion model

Engine v2 replaces the first three-dial sampler. The first version knew five
consonant classes and a front/back vowel direction; blind judges read its
intended mood correctly about 28% of the time (chance is 14%) and rated its
available names 1.9 / 5. This document records what changed, which parts rest
on published evidence, which on data we collected, and which on taste.

## The model in one page

A name is scored by three separate things, each with its own source:

| Part | Question | Source |
| --- | --- | --- |
| **Mood** | Does it carry the requested feeling? | Published sound-symbolism ratings → a seven-dimension sound table; mood recipes and accents are design choices |
| **Name prior** | Does it look like a name people want? | Our own sample of 29,165 generated spellings labelled by whether the `.com` is registered |
| **Teacher** | Would a reader call it that mood, and call it good? | 4,450 blind judgments of generated names by an LLM acting as a naming consultant |

Generation has two stages:

1. **Propose.** A grammar of spelling tokens (below) is sampled without
   replacement. Each token's weight is its learned prior times its mood fit.
   Shapes fix the letter count and the syllable count exactly.
2. **Select.** Proposals are judged as whole words in rounds of 256. Each round
   keeps its best candidates until it expects about 1.5 unregistered names among
   them (2–16 kept). Hard rules reject ambiguous or unfortunate spellings. A
   kept name blocks later one-token variants of itself, and a distinctive
   consonant group (`zzl`, `str`, `ndr`) may recur only after 12 other names.

Everything is deterministic for a given seed, settings and engine data.

## Grammar

A word is alternating runs of consonant letters and vowel letters (`a e i o u y`;
the `u` of `qu` stays with its `q`). Every run is one token, so a spelling has
exactly one decomposition. Tokens are position-specific:

- **Onsets** (`l`, `k`, `c`, `st`, `br`, `qu`, `x`…), **medials** (`n`, `nd`,
  `ll`, `ndr`, `zzl`…), **codas** (`n`, `x`, `rk`, `ck`…).
- **Vowels** by position: single letters, a few one-syllable digraphs (`ai`,
  `au`, `ou`, `ee`, `oo`, final `ie`/`ue`), and two-syllable hiatus (`ia`,
  `io`, `eo`, final `ea`). Medial digraphs are heavily penalised in every mood;
  judges kept reading them as typos.
- Each token lists the abstract sounds it stands for (`c` and `k` are both /k/;
  `x` is /k s/; `ph` is /f/) and tags such as `dbl` (doubled letter), `hi`
  (hiatus), `exotic`, `long`.

`--syllables` now counts intended spoken syllables (a hiatus token counts two),
not vowel groups. Vowel letters are read as plain qualities; the engine still
does not model stress or English vowel alternations.

Spellings that an English reader would sound two ways are never shown: soft
`c`/`g` before `e i y`, doubled consonants after a digraph, a second `y`. A
`y` is only a clean vowel right after the opening consonant or at the very end;
`i-`/`e-`/`u-` openings and long `-er` endings are marked down for unclear
stress. A blocklist of about 620 fragments removes profanity and unfortunate resemblances
(`-noma`, `fist`, `vile`, `covid`…). It is deliberately broad: a false positive
costs one candidate.

## Mood: the evidence

### What the literature supports

The primary source remains Sidhu, Vigliocco & Pexman (2022). [1] For v2 we
downloaded the raw ratings from the study's OSF archive and recomputed class
means for all 25 rated scales rather than using only the four factors. Values
are class mean minus grand mean on a 1–7 scale; positive means toward the second
word of the pair.

| Scale | Sonorant | Voiced fric. | Voiceless fric. | Voiceless stop | Voiced stop | Front − back vowel |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Exciting–Calming | +0.87 | −0.59 | +0.09 | −0.42 | +0.05 | −0.34 |
| Fast–Slow | +0.70 | −0.53 | −0.06 | −0.38 | +0.27 | −0.50 |
| Heavy–Light | +0.63 | −0.40 | +0.40 | −0.24 | −0.38 | +0.37 |
| Big–Small | +0.50 | −0.48 | +0.31 | +0.03 | −0.36 | +0.72 |
| Delicate–Rugged | −0.89 | +0.40 | −0.30 | +0.49 | +0.29 | −0.11 |
| Sharp–Round | +0.98 | −0.81 | 0.00 | −0.65 | +0.47 | −0.53 |
| Abrupt–Continuous | +0.83 | −0.48 | +0.27 | −0.49 | −0.13 | −0.14 |
| Hard–Soft | +0.89 | −0.52 | +0.37 | −0.59 | −0.15 | −0.09 |
| Ordinary–Unique | −0.32 | +0.48 | +0.12 | −0.14 | −0.15 | +0.12 |
| Simple–Complex | −0.71 | +0.78 | −0.01 | +0.11 | −0.17 | +0.05 |
| Masculine–Feminine | +0.73 | −0.30 | +0.68 | −0.68 | −0.43 | +0.46 |
| Happy–Sad | +0.14 | −0.04 | −0.08 | −0.01 | 0.00 | −0.41 |

Recomputed cells match the authors' published coefficient file within 0.03
where it reports a value. Three findings shaped the design:

- **Consonants dominate.** Consonant class explains .60–.64 of between-word
  variance in sharp/round, hard/soft and exciting/calming; vowel frontness .00–.10.
  Vowels matter about as much as consonants only for size, and carry most of
  happy/sad.
- **Valence is nearly flat across consonant classes.** Sound choice mostly moves
  a name along one calm-light-soft ↔ strong-heavy-sharp axis. A review of the
  brand-name literature reaches the same conclusion for evaluation and potency
  and finds no consistent activity mapping. [2] Moods that share a region of
  that axis (calm, airy, lyrical) therefore have to be separated by structure:
  rhythm, endings, repetition, how much complexity a word may carry.
- **Voicing interacts with manner.** Voicing raises activity for fricatives and
  lowers it for stops, so "voiced" is not a usable dial on its own.

Finer distinctions inside a class come from weaker evidence and are used only
as ordinal hints:

| Hint | Source and strength |
| --- | --- |
| /l/ carries most of the sonorant round/soft/calm effect; /n/ is the most feminine | Per-phoneme regression on Sidhu's 40 word means; each phoneme occurs in 3–7 words, errors as large as effects [1] |
| /z/ is sharp, fast, unusual; /v/ behaves closer to a sonorant but reads fast and (in one Japanese study) luxurious | Same regression; onset ratings of written nonwords [3]; luxury study [4] |
| /k/ is the sharpest, hardest voiceless stop; /p/ is small and nearly neutral | Same regression; onset ratings [3] |
| /g/ and /b/ read large; /b/ and /m/ read round | Onset ratings [3]; cue weights in a large nonword study [5] |
| /i/ small, bright, positive; /a/ large; /o u/ round; a lone short "uh" is disliked | Size adjectives, vowel-valence experiments, top-brand corpus [6][7][8] |
| Letters matter on the page: `x k t` sharp, `o m b u` round | Letter cue weights; letter curvature outweighs phonology for written stimuli [5][9] |
| Bilabials /p b m/ and reduplication read cute | Japanese studies, read only in summary; treated as a heuristic [10] |

### The sound table

Each abstract sound has a value on seven dimensions in `core/constants.json`:
`energy`, `weight`, `novelty` (the three user dials, after Sidhu's activity,
potency and novelty factors), plus `sharp`, `flow` (continuous/soft/mellow),
`bright` (vowel brightness and happy/sad) and `bounce`.

The first five consonant columns follow the class deviations above, with the
ordinal hints applied inside each class. `bright` for consonants and all of
`bounce` are design values. The numbers are sampling preferences on a −1…+1
scale, not predicted ratings.

A token's fit is the dot product of its mean sound vector with the mood target,
scaled by `beta`.

### Mood recipes

Each mood is a target on the seven dimensions plus a structural character.
All of the character columns are design decisions informed by the sources, not
fitted values.

| Mood | Feels | Energy | Weight | Novelty | Sharp | Flow | Bright | Bounce | Rhythm | Signature |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| airy | light, breezy, delicate | 4 | 0.5 | 3 | 4 | 8 | 8 | 3 | −0.1 | f s h v |
| lyrical | flowing, melodic, elegant | 3 | 3 | 4 | 2 | 10 | 5 | 2 | +0.3 | l r v n s |
| grounded | solid, sturdy, dependable | 2.5 | 9.5 | 2 | 2.5 | 3 | 1 | 3.5 | −0.7 | b d g m n r |
| playful | fun, bouncy, cute | 7.5 | 3 | 5.5 | 5 | 4 | 7 | 10 | −0.7 | p b k t d z j ch |
| bold | powerful, forceful | 9 | 8.5 | 5 | 8 | 1.5 | 3 | 4.5 | −0.8 | k t d g b z v r |
| calm | restful, soothing, gentle | 1 | 3.5 | 2 | 1 | 9 | 4 | 3 | −0.1 | l m n |
| crisp | sharp, precise, clean-cut | 7 | 4 | 4.5 | 9.5 | 2 | 6 | 3 | −0.9 | k t p |
| round | plump, soft-cornered, huggable | 2.5 | 7 | 3 | 0 | 6 | 2 | 6 | −0.3 | b m |
| regal | stately, classical, noble | 4 | 7.5 | 3 | 4 | 6 | 3 | 2 | +0.1 | r l d v g |
| zen | minimal, balanced, serene | 4 | 4.5 | 4 | 5.5 | 5 | 5 | 3 | +0.4 | k n t s m |
| nordic | cool, clear, northern | 5 | 6 | 4 | 6 | 4 | 5 | 2 | −0.6 | sk sv st kv kl, nd ld lv, h |
| future | high-tech, sci-fi, engineered | 6.5 | 5 | 8 | 7 | 4 | 6 | 3 | −0.4 | x z v k t |
| mystic | mysterious, moonlit, enchanted | 3 | 6.5 | 7 | 4 | 6 | 1.5 | 2 | −0.2 | y as a vowel, th |
| island | tropical, sunlit, easygoing | 3 | 3.5 | 4 | 3 | 8 | 6 | 5 | +0.5 | k l h n m p w |
| strange | unusual, alien, otherworldly | 6 | 5 | 10 | 6 | 5 | 5 | 5 | −0.45 | z v k j x |

Airy, lyrical, playful and bold are the picker's first row; the rest open from
its "+ More" chip.
A mood is a curated bundle: this dial position plus its signature, endings and
style. A dial position alone is not a mood. See [The palette](#the-palette) for
how each one earned its place.

- **Rhythm** shifts the preferred syllable count, which is
  `1.1 + 0.27 × letters + rhythm` (about 2.7 at six letters, 3.3 at eight).
  Bold and grounded names are denser; lyrical names have more syllables.
- **Signature**: a name must contain one of the mood's signature sounds and
  should open with one. The mood has to be audible, not merely uncontradicted.
- **Budget**: how many complex elements (clusters, digraphs, doubled letters) a
  word may carry: 0.5 for calm, 2.5 for playful. It grows by half an element
  per letter beyond six.
- **Repeat**: echoed sounds cost every mood except playful, where a repeated
  syllable or consonant is rewarded. Repetition can lift affect in spoken
  names [11]; we apply it only where it reads as intended.
- **Tags, accents, endings**: per-mood log-weights for token styles (doubled
  letters and `-zzl-` medials for playful, `y` and rare letters for strange),
  for individual sounds, and for final tokens (`-a` and `-ia` for lyrical, `-x`
  and `-r` for bold, `-n` and `-r` for grounded). Endings follow the linguistic
  gender scale used by Pogacar et al.: final schwa-like `-a`, then other vowels,
  then sonorants, fricatives and stops, from soft to hard. [12] Onset accents
  such as `gl-`/`fl-` and `st-`/`gr-` are phonaestheme-flavoured taste.
- All moods now default to `ending: either` with a soft preference; an explicit
  `--ending` remains a hard constraint.

Blending interpolates the dial targets and every numeric character value;
`--energy`, `--weight` and `--novelty` then override their dimension. The
dials keep their v1 meaning. A dial moved away from the mood's own recipe is an
explicit request, so the offset has its own gain (`dialGain`) on top of the
recipe. The energy dial carries sharpness and (inversely) flow with it, and
weight carries darkness, because those dimensions move together in the rating
data; a probe of all seven dimensions showed sharpness and weight change
output most. The picker therefore labels the three dials Sharpness, Weight and
Novelty; the setting keys are unchanged. For example, moving lyrical's energy from 0 to 10 roughly halves the share
of `l m n w` letters and multiplies `k t p z` several times over. Novelty additionally loosens the name
prior and favours rare letters.

## The palette

A mood enters the palette only if a blind judge, given one neutral line per
mood, can pick its names out from all the others. Candidates were tuned and
re-judged over five rounds (20 available names per mood, default length).

| Mood | Read as intended, final round | Quality | What the judge keyed on |
| --- | ---: | ---: | --- |
| future | 100% | 2.95 | `-ex/-ix/-ax/-ox` endings with z, v, k |
| regal | 95% | 3.05 | Latinate `-us/-or/-os/-um` on a d/v/r base |
| island | 90% | 3.30 | vowel runs with only k, l, h, n, m, p |
| round | 90% | 2.70 | b, m, l with o and a final `-o` |
| playful | 85% | 2.75 | doubled consonants, `-o/-i/-y` bounce |
| grounded | 80% | 2.55 | d, g, m, n with closed `-an/-on/-orn` |
| nordic | 75% | 2.90 | `sv-/kv-/st-/kl-` onsets, `-vik/-en/-ind` |
| airy | 70% | 2.75 | f, ph, s, l with light e/i |
| crisp | 70% | 2.45 | t, k, c stops with i/e, short `-ca/-ta` |
| zen | 70% | 2.95 | open consonant–vowel syllables ending `-o` |
| bold | 65% | 2.60 | hard k, g, z, r clusters, stressed a/o |
| calm | 60% | 2.95 | soft s, n, l, m, gentle `-an/-en/-a` |
| mystic | 60% | 2.90 | y as a vowel, `my-/ny-` openings, `-ys/-yr` |
| lyrical | 55% | 3.05 | l, r, v liquids, `-ia/-io` |
| strange | 50% | 2.05 | x/q/j openings; partly a bin for odd names |

Overall 74% across fifteen moods (chance is 6.7%), quality 2.79. This round is
held out (`data/teacher-heldout.tsv`, round 12).

Three clusters remain hard to split and always will be to some degree:
calm / lyrical / airy, round / playful, and grounded / regal / nordic / bold.
Strange is the weakest mood on both counts; future took over the part of it
that worked.

Candidates that were tried and retired:

| Candidate | Idea | Why it went |
| --- | --- | --- |
| swift | z, v, s, f for motion | 25–55% over four rounds; read as airy, then future, then strange |
| velvet | sh, v, l for a hush | 15%; indistinguishable from calm and lyrical |
| sunny | bright a/i vowels | 0%; no cue a reader could find |
| rugged | g, k, r clusters | 85%, but it took bold down to 40%; the two are one mood |
| zesty | Italianate doubles, `-etto/-ino` | 35%; read as playful |

Three engine additions support curated moods. `focus` lets a mood outweigh the
mood-independent prior. Rime endings (`$us`, `$ix`, `$en`) score the final
vowel and consonant together during selection. Signatures may name whole
tokens (`=sk`, `=y`) as well as sounds.

## Name prior: what registered names look like

`scripts/sample-registrations.ts` drew raw, unselected proposals from every
mood at 6, 7 and 8 letters and recorded whether each `.com` has NS records
(DNS only; NXDOMAIN is a training label, never an availability claim).
`data/registered-sample.tsv` holds 29,165 labels; 25,938 are spellable by the
final grammar and are used.

| Letters | Labels | Raw proposals already registered |
| --- | ---: | ---: |
| 6 | 13,128 | 51.7% |
| 7 | 11,140 | 11.2% |
| 8 | 4,897 | 1.5% |

`scripts/build-prior.ts` fits a logistic regression of registration on token
identity per slot, whole-word structure and the mean letter-trigram surprise
under the bundled CMU dictionary. Held-out AUC is **0.914**. Notable
coefficients: one bit less trigram surprise multiplies the odds by about 9;
vowel-initial names, clusters and repeated consonants lower them; open endings
raise them. The inward-articulation ("in–out") preference reported in the
laboratory [13] is absent in this data (coefficient −0.06), so the engine does
not use it.

The prior enters in three places:

1. **Proposal weights** use the per-token coefficients, tempered by novelty.
2. **Selection** penalises only a shortfall below the lower quartile of
   registered names. Credit above that line is small at six letters and full
   from eight. The reason is a winner's curse: at six letters almost every
   spelling the model loves is taken, so chasing the model's favourites selects
   the ones registrants passed over. An early build with full credit produced
   `Mumono`, `Sulolo`, `Kragra`.
3. **Strictness** uses the model's estimate that a candidate is taken (its
   intercept and per-length offsets are shipped) to decide how many candidates
   each round passes. Crowded corners pass up to 16 of 256; at eight letters,
   where nearly everything is free, only the best two or three pass.

Registration is a behavioural proxy for "someone wanted this name". It reflects
domain investors as well as brands, and it is English-internet specific.

## Teacher: distilled blind judgments

During development, batches of domain-filtered names were shuffled with
names from other builds and given to a fresh LLM instance with no knowledge of
their source. It labelled each name with one of the seven moods (defined in one
neutral line each) and a 1–5 quality grade. `data/teacher-judgments.tsv` keeps
the 4,450 judgments from rounds 1–6 (seven moods) and 8–11 (the palette
rounds, 16–18 moods each); 2,512 distinct names are spellable by the final
grammar. The prompt is `scripts/eval/judge-prompt.md`, generated for the
current mood list by `scripts/eval/judge-prompt.py`.

`scripts/build-prior.ts` distils them into a compact model (sound counts, first
sound, final token, style tags and structure):

| Check | Value |
| --- | ---: |
| Two judges agree on a name's mood (613 names judged in two rounds) | 79% |
| Model predicts a judge's mood for unseen names, seven moods (5-fold by name) | 78% |
| Same, after the palette rounds (fifteen moods) | 71% |
| Two judges' quality grades correlate | r = 0.81 |
| Model's quality prediction for unseen names | r = 0.48 |

In selection the model adds the log-probability that a judge would read the
intended mood (capped once it passes 85%, since more certainty only buys
sameness) and twice the predicted quality.

This is the teacher-assisted route from the research direction. It is circular
by construction: the same kind of judge that trained it also evaluates it. It
measures agreement with an LLM's reading of names, not with listeners.

## Measured results

Every batch is 30 names per mood taken from the real pipeline with the `.com`
filter on, shuffled blind with the other batches of its round. Judges differ in
harshness, so only numbers from the same round are comparable; from round 4 on
the same earlier batch (the round-2 v2 build, "anchor") is included in every
sheet for calibration.

| Round | Batch | Letters | Mood read as intended | Quality (1–5) | Graded 4–5 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | v1 engine | 6 | 27% | 1.95 | 2% |
| 1 | first v2 prototype | 6 | 71% | 2.66 | 7% |
| 2 | v1 engine | 6 | 30% | 1.91 | 0% |
| 2 | v2 with registration prior (anchor) | 6 | 68% | 2.82 | 12% |
| 5 | anchor | 6 | 65% | 2.37 | 1% |
| 5 | v2 with teacher layer | 6 | 73% | 2.53 | 1% |
| 5 | v2 with teacher layer | 7 | 84% | 2.70 | 7% |
| 6 | anchor | 6 | 62% | 2.40 | 2% |
| 6 | near-final | 6 | 79% | 2.55 | 2% |
| 6 | near-final | 7 | 70% | 2.80 | 14% |
| **7** | anchor | 6 | 64% | 2.38 | 2% |
| **7** | **shipped build, default settings** | **7** | **81%** | **2.72** | **11%** |

Round 7 was judged after the last retrain and is not part of the teacher data
(`data/teacher-heldout.tsv`). Of its 210 names, 57 had never been judged
before; on those alone the shipped build scored 82% and 2.60. Per mood in round
7: calm 80%, airy 77%, grounded 93%, bold 87%, playful 87%, lyrical 87%,
strange 60%; quality from 2.13 (strange) to 3.33 (lyrical).

Mood agreement with a judge cannot be expected to pass the 79% at which two
judges agree with each other. Quality is where the gap remains: no round
produced more than a handful of names a judge would grade 5.

What the judges consistently rewarded: one obvious pronunciation, clean
consonant–vowel rhythm, an ending that resembles a real word family (`-an`,
`-a`, `-or`, `-ix`), and one distinctive consonant moment. What they punished:
vowel-initial stems with unclear stress, mid-word `y`, stacked clusters, clipped
stop endings, near-duplicates, strings of only `l m n s` with nothing to
remember, and resemblances to unfortunate words.

## Limits

- **Six letters is nearly mined out for soft names.** With the filter on, 2–8%
  of calm or lyrical six-letter candidates are free, against 27–60% at seven
  letters. The free six-letter names are what registrants left. Seven-letter
  batches were graded higher in every round that compared them and fill a page
  in seconds, so the default length is now 7.
- **Selection costs CPU.** Each kept name is the best of roughly 15–130 scored
  proposals. Bulk generation runs at about 1,400 names per second where v1
  produced several hundred thousand. See [performance](performance.md).
- **The teacher is circular.** It was trained on the kind of judge that
  evaluates it, and its quality prediction is modest (r = 0.48).
- No listener study has been run. LLM judgments and registrations are proxies.
- English-reading assumptions throughout; Japanese and German findings are used
  only as hints.
- No stress model. Readings of vowel letters are nominal.
- The recipes, accents, endings, budget and blocklist are taste. They are in
  `core/constants.json` and are meant to be edited.

## Rebuilding

```sh
npx tsx scripts/sample-registrations.ts --per=700 --lengths=6,7,8 --seed=N  # optional: more labels
npx tsx scripts/build-prior.ts            # core/prior.json from data/
npx tsx scripts/update-fixtures.ts        # refresh engine snapshots
npx tsx scripts/refresh-web-fixtures.ts   # refresh browser workload fixtures
npm test
```

The feedback loop used for every tuning step:

```sh
scripts/eval/batch.sh /tmp/bne-eval/new 30            # real pipeline, filter on
python3 scripts/eval/blind.py make /tmp/bne-eval/r8 anchor=/tmp/bne-eval/old new=/tmp/bne-eval/new
# give r8.sheet.txt to a fresh judge with scripts/eval/judge-prompt.md → r8.judged.json
python3 scripts/eval/blind.py score /tmp/bne-eval/r8
python3 scripts/eval/blind.py append /tmp/bne-eval/r8 8 data/teacher-judgments.tsv   # optional
node dist/cli.mjs judge velora --mood lyrical         # why one name scores as it does
```

Any change to `core/constants.json` or `core/prior.json` changes `ENGINE_ID`,
which keys saved searches, so retuned sequences never mix with old pages.

## Sources

Read or recomputed 13 November 2026 unless marked.

1. Sidhu, Vigliocco & Pexman (2022), *Higher order factors of sound symbolism*.
   [DOI](https://doi.org/10.1016/j.jml.2022.104323), [OSF data](https://osf.io/gruqs/).
   Raw ratings downloaded; class means and per-phoneme regression recomputed.
2. Motoki, Park, Pathak & Spence (2022), *The connotative meanings of sound
   symbolism in brand names: A conceptual framework*. Manuscript read.
3. Monaghan & Fletcher (2019), *Do sound symbolism effects for written words
   relate to individual phonemes or to phoneme features?* Paper read; onset
   means recomputed from the OSF data.
4. Motoki et al., luxury brand names (Japanese sample). Manuscript read.
5. Westbury, Hollis, Sidhu & Pexman (2018), *Weighing up the evidence for sound
   symbolism*. Paper read; sparse cue weights only.
6. Winter & Perlman (2021), size adjectives. Read in summary.
7. Körner & Rummer (2022, 2023), vowel valence. Tables read by a delegated reader.
8. Pogacar, Plant, Rosulek & Kouril (2015), *Sounds good: Phonetic sound
   patterns in top brand names*. Paper read.
9. Cuskley, Simner & Kirby (2017), letter shape and phonology. Read in summary.
10. Kumagai; Kawahara and colleagues, cuteness and size. Search summaries only.
11. Argo, Popa & Smith (2010), *The Sound of Brands*. Abstract.
12. Pogacar, Angle, Lowrey, Shrum & Kardes (2021), *Is Nestlé a Lady?* Paper and
    appendix read.
13. Topolinski and colleagues, in–out effect; Motoki & Pathak replication read.

Also read: Crystal (1995), *Phonaesthetically speaking*; Slepian & Galinsky
(2016); Sidhu et al. (2019, 2021); McCormick et al. (2015); Knoeferle et al.
(2017); Adelman, Estes & Cossu (2018); Aryani et al. (2018). Klink (2000, 2001),
Klink & Athaide (2012), Yu et al. (2021) and Auracher et al. (2010) could not
be retrieved in full and are not relied on.
