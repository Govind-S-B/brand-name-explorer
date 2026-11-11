#!/usr/bin/env python3
"""Generate spelling-based faux names. Requires Python 3.9+, no dependencies.

Examples:
    python3 name_generator.py --mood playful --no-check-com --count 20
    python3 name_generator.py --mood calm --energy 7 --weight 3 --novelty 6 --no-check-com --count 20
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
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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


def check_com(domain):
    """Only definitive registry responses are cacheable; failures stay unknown."""
    request = Request(f"https://rdap.verisign.com/com/v1/domain/{domain}",
                      headers={"Accept": "application/rdap+json", "User-Agent": "FauxNameGenerator/1.0"})
    try:
        with urlopen(request, timeout=15) as response:
            record = json.load(response)
        if isinstance(record, dict) and str(record.get("ldhName", "")).lower() == domain:
            return "registered"
        return "unknown (unexpected registry response)"
    except HTTPError as error:
        error.close()
        if error.code == 404:
            return "possibly available"
        if error.code == 429:
            return "unknown (rate limited)"
        return f"unknown (HTTP {error.code})"
    except (URLError, TimeoutError, OSError, ValueError):
        return "unknown (lookup failed)"


def load_cache(path):
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or any(
        not isinstance(record, dict)
        or record.get("status") not in ("registered", "possibly available")
        or not isinstance(record.get("checked_at"), str)
        for record in data.values()
    ):
        raise ValueError(f"Invalid cache file: {path}")
    return data


def save_cache(path, cache):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(cache, indent=2) + "\n")
    temporary.replace(path)


class LookupFailure(Exception):
    pass


class DomainLookup:
    def __init__(self, path):
        self.path = path
        self.cache = load_cache(path)
        self.requested = False

    def get(self, domain, fresh_since=None):
        record = self.cache.get(domain)
        if record and (fresh_since is None or record["checked_at"] >= fresh_since):
            return [domain, record["status"], "cache", record["checked_at"]]
        for attempt in range(3):
            if attempt:
                time.sleep(2 ** attempt)
            elif self.requested:
                time.sleep(1)
            status = check_com(domain)
            self.requested = True
            if status in ("registered", "possibly available"):
                checked_at = datetime.now(timezone.utc).isoformat()
                self.cache[domain] = {"status": status, "checked_at": checked_at}
                save_cache(self.path, self.cache)
                return [domain, status, "live", checked_at]
        raise LookupFailure(f"{domain}: {status} after 3 attempts. "
                            "Progress saved; rerun without --refresh to retry this domain.")


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


class BrowseSession:
    """Persist the checked prefix and available results, independent of page size."""
    def __init__(self, cache_path, style="calm", seed=42, length=None, refresh=False, space=None):
        self.space = space if space is not None else LegacySpace(style, seed, length)
        self.capacity = self.space.capacity
        settings = self.space.settings
        key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()
        self.path = cache_path.parent / (cache_path.stem + "_sessions") / (key + ".json")
        self.lookup = DomainLookup(cache_path)
        if self.path.exists() and not refresh:
            self.state = json.loads(self.path.read_text())
            state = self.state
            if (not isinstance(state, dict) or state.get("settings") != settings
                    or not isinstance(state.get("cursor"), int)
                    or not 0 <= state["cursor"] <= self.capacity
                    or not isinstance(state.get("matches"), list)
                    or len(state["matches"]) > state["cursor"]
                    or any(not isinstance(row, list) or len(row) != 4
                           or row[1] != "possibly available" for row in state["matches"])):
                raise ValueError(f"Invalid browsing progress: {self.path}")
        else:
            self.state = {"settings": settings, "cursor": 0, "matches": [],
                          "fresh_since": datetime.now(timezone.utc).isoformat() if refresh else None}
            save_cache(self.path, self.state)

    def page(self, count, page):
        start, stop = page_bounds(count, page, self.capacity)
        matches = self.state["matches"]
        for row in matches[start:stop]:
            yield [row[0], row[1], "saved", row[3]]
        if len(matches) >= stop:
            return
        names = itertools.islice(self.space.names(),
                                 self.state["cursor"], None)
        for name in names:
            row = self.lookup.get(name.lower() + ".com", self.state.get("fresh_since"))
            available = row[1] == "possibly available"
            if available:
                matches.append(row)
            self.state["cursor"] += 1
            save_cache(self.path, self.state)
            if available and len(matches) > start:
                yield row
            if len(matches) >= stop:
                return

    def summary(self, count, page):
        found = len(self.state["matches"])
        checked = self.state["cursor"]
        total = str((found + count - 1) // count) if checked == self.capacity else "?"
        return (f"page={page}/{total} matches_found={found:,} "
                f"candidates_checked={checked:,}/{self.capacity:,}")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mood", choices=MOODS, help="sound recipe (default: calm); dials override the recipe")
    parser.add_argument("--blend", metavar="MOOD:FRACTION", help="blend recipe dials, e.g. playful:0.3; keep base ending")
    for dial, (low, high) in DIALS.items():
        parser.add_argument("--" + dial, type=float, metavar="0..10", help=f"0 = {low}; 10 = {high}; 5 = no directional bias")
    parser.add_argument("--style", choices=PRESETS, help="original letter-pattern engine; cannot combine with mood controls")
    parser.add_argument("--length", type=int, help="exact character count; mood default 6 (3–14); legacy defaults calm 6, flowing 5, expansive 7")
    parser.add_argument("--syllables", type=int, help="mood grammar vowel groups, 1–5; default: automatic")
    parser.add_argument("--ending", choices=("open", "closed", "either"), help="vowel or consonant ending; default from mood")
    parser.add_argument("--seed", type=int, default=42, help="sequence seed (default: 42)")
    parser.add_argument("--check-com", action=argparse.BooleanOptionalAction, default=True,
                        help="check .com registration (default: on); --no-check-com also bypasses filtering")
    parser.add_argument("--cache", type=Path, default=Path(__file__).resolve().with_name("domain_cache.json"),
                        help="domain cache; browsing progress is saved in a sibling <cache-stem>_sessions folder")
    parser.add_argument("--refresh", action="store_true", help="rebuild this filtered session with fresh lookups; may change pages")
    parser.add_argument("--hide-registered", "--exclude-registered", action=argparse.BooleanOptionalAction,
                        default=True, help="show only possibly available domains (default: on); --no-hide-registered shows all")
    parser.add_argument("--count", type=int, default=200, help="results per page (default: 200)")
    parser.add_argument("--page", type=int, default=1, help="1-based result page (default: 1)")
    parser.add_argument("--list-variants", action="store_true", help="show styles, letters, and allowed lengths")
    parser.add_argument("--list-moods", action="store_true", help="show recipes and exit without lookups")
    parser.add_argument("--list-dials", action="store_true", help="show dial endpoints and exit without lookups")
    parser.add_argument("--explain", action="store_true", help="show effective settings and space size; do not generate or look up")
    return parser


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
        print("--syllables 1..5 and --ending open|closed|either independently control structure.")
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
        mood_controls = (args.mood, args.blend, args.energy, args.weight, args.novelty, args.syllables, args.ending)
        if args.style and any(value is not None for value in mood_controls):
            raise ValueError("--style uses the original engine; use --mood to combine mood dials and structure controls")
        if args.style:
            space = LegacySpace(args.style, args.seed, args.length)
        else:
            space = MoodSpace(args.mood or 'calm', args.length if args.length is not None else 6,
                              args.seed, args.blend, args.energy, args.weight, args.novelty,
                              args.syllables, args.ending)
        capacity = space.capacity
        start, stop = page_bounds(args.count, args.page, capacity)
    except ValueError as error:
        parser.error(str(error))
    if args.explain:
        print(space.describe())
        print(f"possible_names={capacity:,}; count={args.count}; page={args.page}")
        print(f"lookup={'on' if args.check_com else 'off'}; filter={'possibly available' if args.check_com and args.hide_registered else 'none'}")
        if not args.style:
            print("Evidence: energy/activity, weight/potency, novelty; docs/sound-dials.md.")
            print("Recipe weights and richer word structures are experimental extrapolations.")
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
    shown = 0
    try:
        if filtered:
            session = BrowseSession(args.cache, refresh=args.refresh, space=space)
            rows = session.page(args.count, args.page)
        else:
            lookup = DomainLookup(args.cache)
            fresh_since = datetime.now(timezone.utc).isoformat() if args.refresh else None
            names = itertools.islice(space.names(), start, stop)
            rows = (lookup.get(name.lower() + ".com", fresh_since) for name in names)
        for row in rows:
            print("\t".join(row), flush=True)
            shown += 1
    except (LookupFailure, OSError, ValueError, KeyboardInterrupt) as error:
        if session:
            print(session.summary(args.count, args.page), file=sys.stderr)
        parser.exit(1, f"Stopped after {shown} displayed results. {error or 'Interrupted; rerun to resume.'}\n")
    if session:
        print(session.summary(args.count, args.page), file=sys.stderr)
        if shown == 0:
            print("No matches on this page; the name space has been exhausted.", file=sys.stderr)
    print("RDAP absence does not guarantee registration availability. Saved results persist until --refresh.", file=sys.stderr)


if __name__ == "__main__":
    main()
