# brand-name-explorer

## Motivation

I always used to struggle with coming up with brand names but had a friend who came up with things effortlessly. He just spews random words and they sound nice. I came across the old [bouba/kiki experiment](https://en.wikipedia.org/wiki/Bouba/kiki_effect) and experimented with a few moods based on it.

I set a few rules for how I want the sounds to be, then generate a sample I can quickly skim through.

To make it faster, I pair it with a TLD search to quickly filter some if I really want to explore unique names.

## Description

making up brand names based on how they sound and feel, with a .com check to filter some out.

## Research direction

Can we invent words by moving through the feelings their sounds evoke?
We're exploring example-based pronunciation changes, generation from perceptual
dimensions, and combinations of both. Read the
[research direction](docs/research-direction.md) for the hypotheses, approaches,
and related projects.

## Run

Python 3.9+, no dependencies.

```bash
python3 name_generator.py
```

Defaults: **calm, 6 characters, seed 42, .com checks on, registered domains hidden,
200 results per page, page 1**.

The full command, in processing order:

```bash
python3 name_generator.py --style calm --length 6 --seed 42 --check-com --hide-registered --count 200 --page 1
```

| Step | Flags | What they do |
| --- | --- | --- |
| Define names | `--style`, `--length` | Choose the valid combinations |
| Order | `--seed` | Set a repeatable order, independent of count and filtering |
| Look up | `--check-com` / `--no-check-com`, `--cache`, `--refresh` | Use saved domain checks or make new ones |
| Filter | `--hide-registered` / `--no-hide-registered` | Show only possibly available domains, or include registered ones |
| Paginate | `--count`, `--page` | Slice the results into pages |

```bash
# Browse the next pages with the defaults
python3 name_generator.py --page 2
python3 name_generator.py --page 3

# Change the ordering and page size
python3 name_generator.py --seed 123 --count 50 --page 2

# Include registered domains: check only the names on this page
python3 name_generator.py --no-hide-registered --count 200 --page 2

# No domain lookups or availability filtering: show generated names immediately
python3 name_generator.py --no-check-com --count 200 --page 2

# Other sound sets
python3 name_generator.py --style flowing --length 7 --seed 42 --count 50 --page 1
python3 name_generator.py --style expansive --length 9 --seed 42 --count 50 --page 1
python3 name_generator.py --list-variants

# Rebuild this browsing session with fresh domain checks
python3 name_generator.py --refresh --count 200 --page 1
```

Calm accepts even lengths from 2 to 14 (default 6). Flowing accepts odd lengths
from 3 to 13 (default 5). Expansive accepts odd lengths from 3 to 15 (default 7).
`--exclude-registered` is an alias for `--hide-registered`. Use `--help` for all flags.

### How browsing works

Style, length, and seed define one ordered sequence. With filtering on, we check
names in order, reuse the domain cache, and save possibly available results in
that same order. We stop as soon as there are enough matches for the requested
page. Page 2 with 200 results needs 400 saved matches. Returning to page 1 uses
saved results; jumping to page 5 fills the list up to 1,000 matches.

Count only changes how that list is sliced. It does not regenerate names or
change the browsing session. Keep count fixed while moving between pages to
avoid overlapping slices. With the same generation settings, page size, and
filter, pages do not repeat names. Switching filters shows a different view of
the same underlying sequence.

With `--no-hide-registered`, we check only the requested page's names and display
both statuses. With `--no-check-com`, we bypass both lookups and filtering, even
if `--hide-registered` is set. No cache or session files are read or written in
that mode.

The default name space has **21,000 combinations**, or **105 unfiltered pages**
of 200. The total number of filtered pages is unknown until all candidates have
been checked. The CLI shows matches found and candidates checked, with `?` for
the total filtered pages until then. The final page may be short or empty.
If too few matches exist, finding the requested page may check the entire space.

### Lookups, errors, and saved progress

Checks use public Verisign RDAP with no API key. New lookups are sequential,
with a one-second pause between domains. A failing lookup gets three attempts
in total, with two- and four-second waits before retries. If it still fails,
we stop, report the error at the end, and exit with a nonzero status. Successful
checks and progress are saved. Rerun without `--refresh` to retry the failed
domain and finish the page. Failed lookups are never displayed as availability
results and do not advance browsing progress.

`domain_cache.json` stores successful checks by full domain across sessions.
`domain_cache_sessions/` stores progress and an ordered snapshot of matching
results for each style, length, and seed. These files are local and gitignored,
along with Python caches and `names*.txt`, `names*.tsv`, and `names*.csv` outputs.
Use `--cache PATH` for another location; its session folder is
`<cache-stem>_sessions/` alongside it. Add your own ignore rule for a custom cache
filename if it doesn't match the supplied rules. Run one checking process at a
time against a cache file.

Saved matches stay stable while browsing, even if another session updates the
shared domain cache. `--refresh` resets the current filtered session and requires
fresh checks as it rebuilds up to the requested page; its pages can change.
A later run without `--refresh` resumes that rebuild, including after failure.
In unfiltered mode, refresh only rechecks the requested page. Other saved
browsing sessions remain unchanged. Changing generator rules may start a new
session or change the sequence.

“Possibly available” means RDAP returned no registration record. Confirm with a
registrar before buying; cached results can become stale. Names are not screened
for existing words, trademarks, or meanings. Mood labels are exploratory sound
preferences, not guarantees about how everyone will perceive a name.

## Checks

```bash
python3 -m unittest discover -s tests
```
