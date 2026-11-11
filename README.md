# brand-name-explorer

## Motivation

I always used to struggle with coming up with brand names but had a friend who came up with things effortlessly. He just spews random words and they sound nice. I came across the old [bouba/kiki experiment](https://en.wikipedia.org/wiki/Bouba/kiki_effect) and experimented with a few moods based on it.

I set a few rules for how I want the sounds to be, then generate a sample I can quickly skim through.

To make it faster, I pair it with a TLD search to quickly filter some if I really want to explore unique names.

## Description

making up brand names based on how they sound and feel, with a .com check to filter some out.

## Run

Python 3.9+, no dependencies.

```bash
python3 name_generator.py
python3 name_generator.py --page 2
python3 name_generator.py --page 3 --hide-registered
```

Defaults: calm, 6 characters, 200 candidates per page, seed 42, and .com checks on.
The default space contains 21,000 unique names across 105 pages.
The CLI reports the current page, total pages, and total names before checking domains.

```bash
# Explore without network requests
python3 name_generator.py --no-check-com

# Start a different sequence, or adjust the page size
python3 name_generator.py --seed 123 --count 50 --page 2

# Other sound sets (each has its own default length)
python3 name_generator.py --style flowing --length 7
python3 name_generator.py --style expansive --length 9
python3 name_generator.py --list-variants

# Recheck domains even if cached
python3 name_generator.py --refresh
```

### Pages

Pages are slices of one seeded permutation. Keep the seed, style, length, and
count unchanged when moving between pages: names will not repeat across pages.
The final page can be shorter; a page beyond the end reports an error.
No generated index files are needed. Deep pages take more work because the
sequence is replayed up to that page. Changing the generator rules or code may
change the sequence.

`--hide-registered` (also `--exclude-registered`) hides registered domains from
the current page. It does not refill from later pages, so page boundaries stay
stable. Unknown or failed checks remain visible. Total pages describe generated
candidates, not the number of unregistered domains.

### Domain checks and local state

Checks use public Verisign RDAP with no API key. New lookups are sequential,
with a one-second pause between requests; 200 uncached checks can take several
minutes. A rate limit stops further network lookups for that run.

Successful results are stored by full domain in `domain_cache.json` beside the
script. Repeated runs reuse them until `--refresh`; network failures are not
cached. The cache includes lookup timestamps and is ignored by Git, along with
Python caches and `names*.txt`, `names*.tsv`, and `names*.csv` output files.
Use `--cache PATH` for another location (add your own ignore rule if needed).
Run one checking process at a time against a cache file.

“Possibly available” means RDAP returned no registration record. Confirm with
a registrar before buying; cached results can become stale. Names are not
screened for existing words, trademarks, or meanings. Mood labels are exploratory
sound preferences, not guarantees about how everyone will perceive a name.

## Checks

```bash
python3 -m unittest discover -s tests
```
