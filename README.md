# brand-name-explorer

making up brand names based on how they sound and feel, with a .com check to filter some out.

<img width="1009" height="341" alt="image" src="https://github.com/user-attachments/assets/224fc6a2-b153-42be-b1b1-9f8b5712cf38" />

## Web app

[Open the web app](https://govind-s-b.github.io/brand-name-explorer/).

The static TypeScript app lives in [`web/`](web/README.md), with mobile and desktop
layouts, offline generation, live domain checks, and a portable shortlist.
The Python CLI below remains unchanged.

```bash
cd web
npm ci
npm run build
npm run preview:pages
# http://127.0.0.1:4173/brand-name-explorer/
```

See the [browser throughput findings](web/docs/browser-throughput.md) and
[verification results](web/docs/verification.md).

## Motivation

I always used to struggle with coming up with brand names but had a friend who came up with things effortlessly. He just spews random words and they sound nice. I came across the old [bouba/kiki experiment](https://en.wikipedia.org/wiki/Bouba/kiki_effect) and experimented with a few moods based on it.

I set a few rules for how I want the sounds to be, then generate a sample I can quickly skim through.

To make it faster, I pair it with a TLD search to quickly filter some if I really want to explore unique names.

## Get Started

Python 3.9+, no dependencies. Start here to see words immediately:

```bash
python3 name_generator.py --mood calm --no-check-com --count 20
```

Three experimental dials, each from **0 to 10**. Five means no directional bias.

| Dial | 0 | 10 |
| --- | --- | --- |
| `--energy` | Restful | Energetic |
| `--weight` | Light / delicate | Heavy / substantial |
| `--novelty` | Familiar-sounding | Unusual / buzzy |

Choose a mood as a starting recipe, then override whichever dials you want:

```bash
python3 name_generator.py --mood calm --energy 8 --weight 2 --novelty 7 --no-check-com --count 20
python3 name_generator.py --mood grounded --energy 5 --no-check-com --count 20
python3 name_generator.py --mood playful --weight 8 --no-check-com --count 20
```

Available moods: **calm, airy, grounded, bold, playful, lyrical, strange**.
These are editable recipes, not scientifically validated emotional categories.

```bash
# Blend the dial settings; keep the base mood's ending
python3 name_generator.py --mood grounded --blend playful:0.3 --no-check-com --count 20

# Control the shape separately: one syllable with a consonant ending
python3 name_generator.py --mood bold --syllables 1 --ending closed --length 4 --seed 42 --no-check-com --count 20

# Longer, open-ending words
python3 name_generator.py --mood lyrical --syllables 3 --ending open --length 7 --seed 42 --no-check-com --count 20

# Inspect the recipes, dials, or effective settings without any lookups
python3 name_generator.py --list-moods
python3 name_generator.py --list-dials
python3 name_generator.py --mood calm --blend bold:0.5 --explain
```

`--length` is an exact character count from 3 to 14. `--syllables` selects 1–5
intended vowel groups; when omitted, the grammar chooses automatically.
`--ending` accepts `open`, `closed`, or `either`. Pronunciation can vary by reader.
Blend first, then explicit dial overrides; blend fractions are from 0 to 1.

## Control hierarchy

1. **Mood** supplies a starting recipe.
2. **Perceptual dials** adjust energy, weight, and novelty.
3. **Sound structure** constrains opening, syllables, and ending.
4. **Spelling constraints** set character length. Alternate spellings of a fixed
   pronunciation are not supported yet.

Explicit settings override their corresponding defaults. Seed, lookup, filtering,
and pagination are separate run controls. See the [control hierarchy](docs/control-hierarchy.md)
for defaults, the research review, internal cluster/repetition behavior, and future gaps.

For example, keep calm's weight and novelty but raise energy and require a vowel opening:

```bash
python3 name_generator.py --mood calm --energy 8 --opening vowel --syllables 3 --ending open --length 7 --seed 42 --no-check-com --count 20 --page 1
```

Use `--opening vowel|consonant|cluster|any` (default `any`). Consonant means one
sound, including sh/ch; cluster means multiple sounds such as br/st. This affects
only the beginning. `any` keeps existing preferences rather than balancing types
equally. Add `--explain` to see the effective values and where each came from.

## Defaults and processing order

Running `python3 name_generator.py` means:

```bash
python3 name_generator.py --mood calm --length 6 --seed 42 --check-com --hide-registered --count 200 --page 1
```

Defaults: **calm, 6 characters, seed 42, .com checks on, registered domains hidden,
200 results per page, page 1**. Calm starts at energy 1, weight 3, novelty 2,
with an open ending. Generation settings come first, then lookup, filtering,
and pagination. Flag order is for readability; argparse accepts any order.

| Step | Flags | Effect |
| --- | --- | --- |
| Define sound preferences | `--mood`, `--blend`, `--energy`, `--weight`, `--novelty` | Choose a recipe, blend settings, then override dials |
| Define structure | `--opening`, `--syllables`, `--ending` | Constrain word shape |
| Constrain spelling | `--length` | Exact character count |
| Order | `--seed` | Repeatable weighted ordering without repeated spellings |
| Look up | `--check-com` / `--no-check-com`, `--cache`, `--refresh`, `--lookup-workers`, `--lookup-rate` | Reuse checks or run bounded concurrent requests |
| Filter | `--hide-registered` / `--no-hide-registered` | Possibly available domains only, or include registered ones |
| Paginate | `--count`, `--page` | Slice the selected results |

## Browse and check domains

```bash
python3 name_generator.py --mood playful --count 200 --page 1
python3 name_generator.py --mood playful --count 200 --page 2
python3 name_generator.py --mood playful --no-hide-registered --count 200 --page 2
python3 name_generator.py --mood playful --refresh --count 200 --page 1
```

With filtering on, saved possibly available names fill the page first. If more
are needed, checking continues in generation order and stops when the page is
full. Page 2 with 200 results needs 400 saved matches. Earlier pages load from
saved results. If insufficient matches exist, the full space may be checked.

With `--no-hide-registered`, only the requested page's names are checked.
`--no-check-com` skips both lookups and filtering and reads/writes no cache files.
`--exclude-registered` is an alias for `--hide-registered`.

Keep generation settings and count fixed while moving between pages: spellings
will not repeat. Count only changes the slice boundaries. Changing a dial starts
a separate session; all sessions share the domain cache. Early pages favor the
requested sounds; later pages increasingly include less-favored combinations.
The total filtered page count is unknown until every candidate has been checked.
The CLI reports `?` until then, alongside matches found and candidates checked.

## Saved progress and errors

Uncached domains first get a live Cloudflare DNS-over-HTTPS NS query. Matching NS
answers mark the domain registered and skip RDAP; NXDOMAIN, missing NS, and DNS
errors still require Verisign RDAP. Availability is always RDAP-confirmed. DNS
has its own pool, limiter, and durable cache; the resolver can be replaced.
The [DNS measurements](docs/domain-lookup-dns.md) show a 4,000-result search falling
from 133.51 to 95.23 seconds, while short pages did not consistently get faster.

Public Verisign RDAP needs no API key. Its pool defaults to **32 workers and a
shared 160-attempt/second ceiling**, starting at 16 and adapting as requests
succeed. Retry timers do not occupy workers; correlated failures reduce active
concurrency, and server throttling applies a shared cooldown. Results are saved
as they finish and displayed in seed order. No failed check is marked available.
See [lookup performance](docs/domain-lookup.md) for measurements and limits.

```bash
python3 name_generator.py --mood calm --length 6 --seed 42 --lookup-workers 32 --lookup-rate 160 --count 200 --page 1
```

Domain records live in `domain_cache.sqlite3`; saved pages use indexed SQLite
files in `domain_cache_sessions/`. Legacy JSON caches and sessions import once,
leaving their originals untouched. These files and database sidecars are local
and gitignored. `--cache PATH` selects another location, with a sibling
`<cache-stem>_sessions/` folder. Use one checking process per cache/session.

Saved pages stay stable until `--refresh` rebuilds the current session with fresh
lookups. Other sessions are unchanged. Rerun without `--refresh` to resume an
interrupted search; later successful checks remain cached even if an earlier
name needs another attempt. `--no-check-com` performs no cache or lookup IO.

“Possibly available” means no RDAP registration record was found; a registrar
must confirm availability. Saved checks can become stale. Names are not screened
for existing words, meanings, trademarks, or homophones.

## Original presets

The original letter-pattern engine and its saved sessions remain available:

```bash
python3 name_generator.py --style calm --length 6 --seed 42 --no-check-com --count 20 --page 1
python3 name_generator.py --style flowing --length 7 --no-check-com --count 20
python3 name_generator.py --style expansive --length 9 --no-check-com --count 20
python3 name_generator.py --list-variants
```

`--style` selects the original engine and cannot be combined with mood controls.
Original calm accepts even lengths 2–14 (default 6), flowing odd lengths 3–13
(default 5), and expansive odd lengths 3–15 (default 7). Original calm at length
6 has 21,000 names; the new mood grammar has a different space and sequence.

## Reverse finder

Invert the current generator for a reference word, or report a representation
gap. Everything runs locally without domain lookups:

```bash
python3 reverse_finder.py lemoru
python3 reverse_finder.py Zafkiel --reading zaf-ki-el
python3 reverse_finder.py Shien --reading she-en
python3 reverse_finder.py Giorno --reading jee-orn-o
python3 reverse_finder.py Shien --reading she-en --substitutions 5
```

The finder shows its reading source and structure. Supported references receive
candidate settings and sample names; unsupported references return `gap` with
specific reasons and no fitted configuration. Optional `--substitutions N`
searches for nearby allowed words separately, showing the sound and structure
changes; it does not turn the original gap into a fit. It uses supplied readings, an
offline pronunciation dictionary, or an explicitly labelled spelling assumption.
Use `--json` for a machine-readable report. See the [reverse finder](docs/reverse-finder.md)
for the engine/generator/inverter split, stress-test results, and limitations.

## Research

The [project comparison](docs/project-comparison.md) shows concrete inputs and
outputs from Wuggy, UniPseudo, Lexifer, LEX-ICON, and our generator, explaining
what each approach lets you control.
It also covers [other brand-naming projects](docs/project-comparison.md#other-work-in-the-brand-name-generation-space),
including two LLM naming skills and how their direction overlaps with ours.

The [research direction](docs/research-direction.md) has four topics:

1. **Richer expressibility** — finer sound qualities and interactions.
2. **Reverse lookup** — word/pronunciation to estimated profile and configurations.
3. **Learned, mixable generation** — encode, blend, and steer a sound space to generate words.
4. **Teacher-assisted enrichment** — use an LLM to supply examples beyond our rule coverage.

These are research directions; the current generator remains rule-based.
The [control hierarchy](docs/control-hierarchy.md) explains the interface and
structural decisions. The [sound-dial research and implementation notes](docs/sound-dials.md) explain
why these three dials were chosen, the underlying study, extrapolations, recipe
values, sampling algorithm, and remaining validation work.

These controls bias sound combinations. They do not measure emotional
probabilities or establish universal impressions across cultures. The illustrative
words from our initial discussion are not a training set or imitation target.

## Checks

```bash
python3 -m unittest discover -s tests
```
