#!/usr/bin/env python3
"""Generate spelling-based faux names. Requires Python 3.9+, no dependencies.

Examples:
    python3 name_generator.py --mood playful --no-check-com --count 20
    python3 name_generator.py --mood calm --energy 8 --opening vowel --syllables 3 --ending open --length 7 --seed 42 --no-check-com --count 20
    python3 name_generator.py --mood grounded --blend playful:0.3 --no-check-com --count 20
    python3 name_generator.py --list-moods
    python3 name_generator.py --list-dials

Dials are experimental sound preferences, not measured emotional probabilities.
See docs/sound-dials.md. Names are not screened for real words or trademarks.
"""

import argparse
import hashlib
import itertools
import random
import json
import sys
import sqlite3
import contextlib
from datetime import datetime, timezone
from pathlib import Path
from domain_lookup import DomainLookup, LookupFailure, load_cache

from sound_profiles import DIALS, MOODS, MoodSpace


PRESETS = {
    "flowing": {
        "pattern": "VCVCV",
        "consonants": "lmnrsv",
        "vowels": "aeiou",
        "starts": "aeo",
        "endings": "aeiou",
    },
    "calm": {
        "pattern": "CVCVCV",
        "consonants": "lmnsvrh",
        "vowels": "aeiou",
        "starts": "aeo",
        "endings": "oaiu",
    },
    "expansive": {
        "pattern": "VCVCVCV",
        "consonants": "lmnrsvw",
        "vowels": "aeiou",
        "starts": "aeo",
        "endings": "aeiou",
    },
}


def name_space(style, length=None):
    config = PRESETS[style]
    length = len(config["pattern"]) if length is None else length
    vowel_first = config["pattern"].startswith("V")
    minimum = 3 if vowel_first else 2
    maximum = 2 * len(set(config["consonants"])) + int(vowel_first)
    if not minimum <= length <= maximum or length % 2 != int(vowel_first):
        parity = "odd" if vowel_first else "even"
        raise ValueError(f"{style} length must be {parity}, from {minimum} to {maximum}; "
                         "names end in a vowel and consonants cannot repeat")
    pattern = ("VC" * length if vowel_first else "CV" * length)[:length]
    consonants = list(itertools.permutations(dict.fromkeys(config["consonants"]), pattern.count("C")))
    vowel_pools = []
    for index, symbol in enumerate(pattern):
        if symbol == "V":
            key = "starts" if index == 0 else "endings" if index == length - 1 else "vowels"
            vowel_pools.append(tuple(dict.fromkeys(config[key])))
    capacity = len(consonants)
    for pool in vowel_pools:
        capacity *= len(pool)
    return pattern, consonants, vowel_pools, capacity


def name_at(index, pattern, consonants, vowel_pools):
    # Decode a sampled index without building millions of candidate strings.
    vowels = []
    for pool in reversed(vowel_pools):
        index, digit = divmod(index, len(pool))
        vowels.append(pool[digit])
    cs = iter(consonants[index])
    vs = iter(reversed(vowels))
    return "".join(next(cs) if symbol == "C" else next(vs) for symbol in pattern).capitalize()


def candidates(style, length=None):
    pattern, consonants, pools, capacity = name_space(style, length)
    for index in range(capacity):
        yield name_at(index, pattern, consonants, pools)


def ordered_names(style="calm", seed=42, length=None):
    """One permutation independent of page size, lookup, and filtering."""
    pattern, consonants, pools, capacity = name_space(style, length)
    rng = random.Random(seed)
    swaps = {}
    for index in range(capacity):
        chosen = rng.randrange(index, capacity)
        value = swaps.get(chosen, chosen)
        replacement = swaps.pop(index, index)
        if chosen != index:
            swaps[chosen] = replacement
        yield name_at(value, pattern, consonants, pools)


def generate(style="calm", count=200, seed=42, length=None, page=1):
    """Select an unfiltered page from the shared sequence."""
    capacity = name_space(style, length)[3]
    start, stop = page_bounds(count, page, capacity)
    return list(itertools.islice(ordered_names(style, seed, length), start, stop))


def page_bounds(count, page, capacity):
    if count < 1 or page < 1:
        raise ValueError("count and page must be at least 1")
    start = (page - 1) * count
    if start >= capacity:
        raise ValueError(f"page {page} is past the {capacity:,} possible names; "
                         f"last unfiltered page is {(capacity + count - 1) // count}")
    return start, page * count


def save_cache(path, cache):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(cache, indent=2) + "\n")
    temporary.replace(path)


class LegacySpace:
    """Keep the original preset sequences and saved session identities intact."""
    def __init__(self, style, seed=42, length=None):
        pattern, _, _, self.capacity = name_space(style, length)
        self.style, self.seed, self.length = style, seed, len(pattern)
        self.settings = {"version": 1, "style": style, "length": len(pattern),
                         "seed": seed, "preset": PRESETS[style]}

    def names(self):
        return ordered_names(self.style, self.seed, self.length)

    def describe(self):
        return f"style={self.style} length={self.length} seed={self.seed}"


class SavedMatches:
    """Read only the requested saved page; keep newly appended rows in memory."""
    def __init__(self, path, count):
        self.path, self.count, self.added = path, count, []

    def __len__(self):
        return self.count + len(self.added)

    def append(self, row):
        self.added.append(row)

    def __getitem__(self, index):
        if isinstance(index, int):
            index = index + len(self) if index < 0 else index
            if not 0 <= index < len(self):
                raise IndexError(index)
            return self[index:index+1][0]
        start, stop, step = index.indices(len(self))
        if step != 1:
            return [self[i] for i in range(start, stop, step)]
        rows = []
        if start < min(stop, self.count):
            with contextlib.closing(sqlite3.connect(self.path)) as db:
                rows = [json.loads(row[0]) for row in db.execute(
                    'SELECT row FROM matches WHERE idx>=? AND idx<? ORDER BY idx',
                    (start, min(stop, self.count)))]
            if any(not isinstance(row, list) or len(row) != 4 or row[1] != 'possibly available' for row in rows):
                raise ValueError(f'Invalid saved matches: {self.path}')
        if stop > self.count:
            rows.extend(self.added[max(0, start-self.count):stop-self.count])
        return rows


class BrowseSession:
    """Persist the checked prefix and available results, independent of page size."""
    def __init__(self, cache_path, style="calm", seed=42, length=None, refresh=False, space=None,
                 workers=32, rate=160.0):
        self.space = space if space is not None else LegacySpace(style, seed, length)
        self.capacity = self.space.capacity
        settings = self.space.settings
        key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()
        self.path = cache_path.parent / (cache_path.stem + "_sessions") / (key + ".json")
        self.lookup = None
        self.progress_path = self.path.with_suffix('.sqlite3')
        self.progress_path.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.closing(sqlite3.connect(self.progress_path)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY, state TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS matches (idx INTEGER PRIMARY KEY, row TEXT NOT NULL)')
            record = db.execute('SELECT state FROM progress WHERE id=1').fetchone()
            if record and not refresh:
                self.state = json.loads(record[0])
                if not isinstance(self.state, dict):
                    raise ValueError(f'Invalid browsing progress: {self.progress_path}')
                count, first, last = db.execute('SELECT COUNT(*), MIN(idx), MAX(idx) FROM matches').fetchone()
                if count and (first != 0 or last != count-1):
                    raise ValueError(f'Invalid match index: {self.progress_path}')
                self.state['matches'] = SavedMatches(self.progress_path, count)
            elif self.path.exists() and not refresh:
                self.state = json.loads(self.path.read_text())
            else:
                self.state = {'settings': settings, 'cursor': 0, 'matches': [],
                              'fresh_since': datetime.now(timezone.utc).isoformat() if refresh else None}
            state = self.state
            if (not isinstance(state, dict) or state.get('settings') != settings
                    or not isinstance(state.get('cursor'), int)
                    or not 0 <= state['cursor'] <= self.capacity
                    or not isinstance(state.get('matches'), (list, SavedMatches))
                    or len(state['matches']) > state['cursor']
                    or (isinstance(state['matches'], list) and any(not isinstance(row, list) or len(row) != 4
                           or row[1] != 'possibly available' for row in state['matches']))):
                raise ValueError(f'Invalid browsing progress: {self.path}')
            self.saved_matches = len(state['matches']) if record and not refresh else 0
            if not record or refresh:
                with db:
                    db.execute('DELETE FROM matches')
                    self._checkpoint(db)
        self.lookup = DomainLookup(cache_path, workers=workers, rate=rate)

    def _checkpoint(self, db):
        matches = self.state['matches']
        with db:
            db.executemany('INSERT INTO matches VALUES (?, ?)',
                           ((i, json.dumps(matches[i])) for i in range(self.saved_matches, len(matches))))
            state = {k: v for k, v in self.state.items() if k != 'matches'}
            db.execute('INSERT OR REPLACE INTO progress VALUES (1, ?)', (json.dumps(state),))
        self.saved_matches = len(matches)

    def page(self, count, page):
        start, stop = page_bounds(count, page, self.capacity)
        matches = self.state["matches"]
        for row in matches[start:stop]:
            yield [row[0], row[1], "saved", row[3]]
        if len(matches) >= stop:
            return
        names = itertools.islice(self.space.names(),
                                 self.state["cursor"], None)
        rows = self.lookup.many((name.lower() + '.com' for name in names),
                                self.state.get('fresh_since'), window=lambda: stop-len(matches))
        db = sqlite3.connect(self.progress_path)
        try:
            for row in rows:
                available = row[1] == 'possibly available'
                if available:
                    matches.append(row)
                self.state['cursor'] += 1
                # Append progress rather than rewriting every previous match.
                # Undisplayed prefixes can commit in batches; displayed rows
                # are committed before yielding, preserving crash-safe pages.
                if (available and len(matches) > start) or self.state['cursor'] % 256 == 0:
                    self._checkpoint(db)
                if available and len(matches) > start:
                    yield row
                if len(matches) >= stop:
                    return
        finally:
            rows.close()
            try:
                self._checkpoint(db)
            finally:
                db.close()

    def summary(self, count, page):
        found = len(self.state["matches"])
        checked = self.state["cursor"]
        total = str((found + count - 1) // count) if checked == self.capacity else "?"
        return (f"page={page}/{total} matches_found={found:,} "
                f"candidates_checked={checked:,}/{self.capacity:,}")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mood = parser.add_argument_group("1. Mood — starting recipe")
    mood.add_argument("--mood", choices=MOODS, help="default: calm; supplies dials and ending")
    mood.add_argument("--blend", metavar="MOOD:FRACTION", help="blend recipe dials, e.g. playful:0.3; retain base structure defaults")
    dials = parser.add_argument_group("2. Perceptual dials — explicit values override the recipe")
    for dial, (low, high) in DIALS.items():
        dials.add_argument("--" + dial, type=float, metavar="0..10", help=f"0 = {low}; 10 = {high}; 5 = no directional bias")
    structure = parser.add_argument_group("3. Sound structure")
    structure.add_argument("--opening", choices=("vowel", "consonant", "cluster", "any"),
                           help="first sound(s); consonant means one sound, including sh/ch; default: any")
    structure.add_argument("--syllables", type=int, help="intended vowel groups, 1–5; default: automatic")
    structure.add_argument("--ending", choices=("open", "closed", "either"), help="vowel, consonant, or unrestricted ending; default from mood")
    spelling = parser.add_argument_group("4. Spelling constraints")
    spelling.add_argument("--length", type=int, help="exact characters; mood default 6 (3–14); original style defaults vary")
    reproducibility = parser.add_argument_group("Reproducibility")
    reproducibility.add_argument("--seed", type=int, default=42, help="sequence seed (default: 42)")
    lookup = parser.add_argument_group("Domain lookup and cache")
    lookup.add_argument("--check-com", action=argparse.BooleanOptionalAction, default=True,
                        help="check .com (default: on); --no-check-com also bypasses availability filtering")
    lookup.add_argument("--cache", type=Path, default=Path(__file__).resolve().with_name("domain_cache.json"),
                        help="domain cache; progress is in a sibling <cache-stem>_sessions folder")
    lookup.add_argument("--refresh", action="store_true", help="rebuild this filtered session with fresh lookups; pages may change")
    lookup.add_argument('--lookup-workers', type=int, default=32, metavar='1..64',
                        help='maximum concurrent registry requests (default: 32)')
    lookup.add_argument('--lookup-rate', type=float, default=160.0, metavar='RPS',
                        help='shared request-rate ceiling, >0 to 320 (default: 160); slows on throttling')
    filtering = parser.add_argument_group("Availability filtering")
    filtering.add_argument("--hide-registered", "--exclude-registered", action=argparse.BooleanOptionalAction,
                           default=True, help="show possibly available domains only (default: on)")
    pagination = parser.add_argument_group("Pagination")
    pagination.add_argument("--count", type=int, default=200, help="results per page (default: 200)")
    pagination.add_argument("--page", type=int, default=1, help="1-based result page (default: 1)")
    inspection = parser.add_argument_group("Inspect without generating or looking up domains")
    inspection.add_argument("--list-moods", action="store_true", help="show recipe defaults")
    inspection.add_argument("--list-dials", action="store_true", help="show dial endpoints")
    inspection.add_argument("--explain", action="store_true", help="show resolved controls, their sources, and space size")
    original = parser.add_argument_group("Original engine")
    original.add_argument("--style", choices=PRESETS, help="original letter-pattern engine; cannot combine with mood/structure controls")
    original.add_argument("--list-variants", action="store_true", help="show original styles and allowed lengths")
    return parser


def explain_controls(args, space):
    if isinstance(space, LegacySpace):
        print("Original engine: " + space.describe())
        print("Structure is fixed by the selected original style.")
    else:
        print(f"1. Mood: {args.mood or 'calm'}" + (f"; blend={args.blend}" if args.blend else ""))
        print("2. Perceptual dials:")
        for dial in DIALS:
            source = 'explicit' if getattr(args, dial) is not None else 'blend' if args.blend else 'mood'
            print(f"   {dial}={space.profile[dial]:g} ({source})")
        print("3. Sound structure:")
        print(f"   opening={space.opening} ({'explicit' if args.opening is not None else 'base default'})")
        print(f"   syllables={space.syllables or 'auto'} ({'explicit' if args.syllables is not None else 'length/ending heuristic'})")
        print(f"   ending={space.profile['ending']} ({'explicit' if args.ending is not None else 'base mood'})")
        print("   clusters: allowed; frequency includes a novelty heuristic; opening restriction takes priority")
        print("   repetition: allowed; stress: unspecified; spelling variants: not supported")
        print(f"4. Spelling: length={space.length} ({'explicit' if args.length is not None else 'base default'})")
    print(f"Reproducibility: seed={args.seed}")
    print(f"Lookup: {'on' if args.check_com else 'off'}; filter: {'possibly available' if args.check_com and args.hide_registered else 'none'}")
    print(f"Pagination: count={args.count}; page={args.page}; possible_names={space.capacity:,}")
    if not args.style:
        print("Sound preferences are experimental; see docs/control-hierarchy.md and docs/sound-dials.md.")


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.list_moods:
        print("mood\tenergy\tweight\tnovelty\tending")
        for mood, profile in MOODS.items():
            print("\t".join([mood] + [str(profile[d]) for d in DIALS] + [profile['ending']]))
        print("Recipes are hypotheses. Dials override recipes; --blend blends dials and keeps the base ending.")
        return
    if args.list_dials:
        for dial, (low, high) in DIALS.items():
            print(f"--{dial}: 0 = {low}; 5 = no directional bias; 10 = {high}")
        print("These correlated preferences guide sampling; they are not emotional probabilities.")
        print("Structure controls: --opening, --syllables, --ending; see --help for groups.")
        return
    if args.list_variants:
        for style, config in PRESETS.items():
            vowel_first = config["pattern"].startswith("V")
            lengths = range(3 if vowel_first else 2, 2 * len(set(config["consonants"])) + int(vowel_first) + 1, 2)
            print(f"{style}: default {config['pattern']} ({len(config['pattern'])} chars); "
                  f"lengths {', '.join(map(str, lengths))}; consonants {config['consonants']}; "
                  f"endings {config['endings']}")
        return
    try:
        mood_controls = (args.mood, args.blend, args.energy, args.weight, args.novelty, args.syllables, args.ending, args.opening)
        if args.style and any(value is not None for value in mood_controls):
            raise ValueError("--style uses the original engine; use --mood to combine mood dials and structure controls")
        if args.style:
            space = LegacySpace(args.style, args.seed, args.length)
        else:
            space = MoodSpace(args.mood or 'calm', args.length if args.length is not None else 6,
                              args.seed, args.blend, args.energy, args.weight, args.novelty,
                              args.syllables, args.ending, args.opening)
        capacity = space.capacity
        start, stop = page_bounds(args.count, args.page, capacity)
    except ValueError as error:
        parser.error(str(error))
    if args.explain:
        explain_controls(args, space)
        return
    filtered = args.check_com and args.hide_registered
    pages = "?" if filtered else str((capacity + args.count - 1) // args.count)
    print(f"{space.describe()} "
          f"page={args.page}/{pages} possible_names={capacity:,} page_size={args.count}", file=sys.stderr)
    if not args.check_com:
        print("\n".join(itertools.islice(space.names(), start, stop)))
        return
    print("domain\tstatus\tsource\tchecked_at_utc", flush=True)
    session = None
    lookup = None
    rows = None
    shown = 0
    try:
        if filtered:
            session = BrowseSession(args.cache, refresh=args.refresh, space=space,
                                    workers=args.lookup_workers, rate=args.lookup_rate)
            lookup = session.lookup
            rows = session.page(args.count, args.page)
        else:
            lookup = DomainLookup(args.cache, workers=args.lookup_workers, rate=args.lookup_rate)
            fresh_since = datetime.now(timezone.utc).isoformat() if args.refresh else None
            names = itertools.islice(space.names(), start, stop)
            rows = lookup.many((name.lower() + ".com" for name in names), fresh_since)
        for row in rows:
            print("\t".join(row), flush=True)
            shown += 1
    except (LookupFailure, OSError, ValueError, sqlite3.Error, KeyboardInterrupt) as error:
        if session:
            print(session.summary(args.count, args.page), file=sys.stderr)
        parser.exit(1, f"Stopped after {shown} displayed results. {error or 'Interrupted; rerun to resume.'}\n")
    finally:
        if rows is not None:
            rows.close()
        if lookup is not None:
            lookup.close()
            print(lookup.summary(), file=sys.stderr)
    if session:
        print(session.summary(args.count, args.page), file=sys.stderr)
        if shown == 0:
            print("No matches on this page; the name space has been exhausted.", file=sys.stderr)
    print("RDAP absence does not guarantee registration availability. Saved results persist until --refresh.", file=sys.stderr)


if __name__ == "__main__":
    main()
