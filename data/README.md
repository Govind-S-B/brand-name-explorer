# Pronunciation data

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
