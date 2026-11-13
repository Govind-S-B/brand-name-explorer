# Data

Three kinds of data feed the engine. `scripts/build-prior.ts` turns all of them
into `core/prior.json`; nothing here is loaded at run time except the dictionary.

## Registration sample

`registered-sample.tsv`: 29,165 generated spellings (6–8 letters, raw proposals
from every mood) and whether the `.com` had NS records when sampled on
13 November 2026 (`1` delegated or present without delegation, `0` NXDOMAIN).
Collected by `scripts/sample-registrations.ts` over public DNS-over-HTTPS at
about ten queries per second; no RDAP. It is a training signal for what
registered names look like. It is not an availability record and goes stale.

## Blind judgments

`teacher-judgments.tsv`: name, intended mood, batch label, judged mood, quality
1–5, round. 3,091 judgments from six blind rounds, made by fresh LLM instances
using `scripts/eval/judge-prompt.md`. Batch labels: `base` is the v1 engine;
the rest are development builds of v2. These train the teacher layer.

`teacher-heldout.tsv`: round 7, the same format. It was judged after the last
retrain and is kept out of training so the published result stays checkable.

These are a model's readings of names, not listener data.

## Pronunciation data

`cmudict.bin` contains all 126,052 words and their ordered alternate readings from
CMUdict, distributed under [its BSD-style license](cmudict-LICENSE.txt).
The bundled source SHA-256 is
`81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22`.
The original upstream source is https://github.com/cmusphinx/cmudict.

To update deliberately, download an upstream `cmudict.dict` outside this tree, then:

```sh
node scripts/pack-dictionary.mjs /path/to/cmudict.dict
npm test
```

The format is `BNE1`, a little-endian JSON-header length, the UTF-8 header, pairs
of 32-bit word/reading offsets per 32-word block (plus end offsets), then separate
word and reading byte streams. Words use prefix/suffix lengths and ASCII suffix
bytes. Readings use a count, length and byte phoneme IDs. Binary search decodes
only block heads and at most 32 entries. No whole-dictionary object graph is built.

`tests/dictionary-golden.json` freezes a SHA-256 of every expanded word/reading
from the independent Python reference. Updating upstream data requires explicitly
reviewing that fixture change. The raw upstream file and the old JSON encoding
are not duplicated in this repository.
