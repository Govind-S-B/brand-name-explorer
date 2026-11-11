#!/usr/bin/env python3
"""Generate spelling-based faux names. Requires Python 3.9+, no dependencies.

Examples:
    python3 name_generator.py
    python3 name_generator.py --page 2 --hide-registered
    python3 name_generator.py --no-check-com --seed 123 --page 3
    python3 name_generator.py --style calm --length 6 --seed 42
    python3 name_generator.py --list-variants
    python3 name_generator.py --style expansive --count 50 > names.txt

Edit PRESETS to adjust the letter sets. Distinct consonants are required
within each name; vowels may repeat. Outputs are not checked against real
words, names, trademarks, or pronunciation dictionaries.
"""

import argparse
import itertools
import random
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


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


def generate(style="calm", count=200, seed=42, length=None, page=1):
    """Slice a seeded permutation; count is the page size, not a refill target."""
    if count < 1 or page < 1:
        raise ValueError("count and page must be at least 1")
    pattern, consonants, pools, capacity = name_space(style, length)
    start = (page - 1) * count
    if start >= capacity:
        raise ValueError(f"page {page} is past the {capacity:,} names available; "
                         f"last page is {(capacity + count - 1) // count}")
    stop = min(start + count, capacity)
    rng = random.Random(seed)
    # Sparse Fisher-Yates: only visit the prefix needed for this page.
    swaps = {}
    names = []
    for index in range(stop):
        chosen = rng.randrange(index, capacity)
        value = swaps.get(chosen, chosen)
        replacement = swaps.pop(index, index)
        if chosen != index:
            swaps[chosen] = replacement
        if index >= start:
            names.append(name_at(value, pattern, consonants, pools))
    return names


def check_com(domain):
    """Only definitive registry responses are cacheable; failures stay unknown."""
    request = Request(f"https://rdap.verisign.com/com/v1/domain/{domain}",
                      headers={"Accept": "application/rdap+json", "User-Agent": "FauxNameGenerator/1.0"})
    try:
        with urlopen(request, timeout=15) as response:
            record = json.load(response)
        if str(record.get("ldhName", "")).lower() == domain:
            return "registered"
        return "unknown (unexpected registry response)"
    except HTTPError as error:
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


def domain_results(names, cache_path, refresh=False):
    cache = load_cache(cache_path)
    requested = False
    for name_index, name in enumerate(names):
        domain = name.lower() + ".com"
        if not refresh and domain in cache:
            record = cache[domain]
            yield domain, record["status"], "cache", record["checked_at"]
            continue
        if requested:
            time.sleep(1)
        status = check_com(domain)
        requested = True
        checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if status in ("registered", "possibly available"):
            cache[domain] = {"status": status, "checked_at": checked_at}
            save_cache(cache_path, cache)
        elif refresh and domain in cache:
            del cache[domain]
            save_cache(cache_path, cache)
        yield domain, status, "live", checked_at
        if status == "unknown (rate limited)":
            for remaining in names[name_index + 1:]:
                domain = remaining.lower() + ".com"
                if not refresh and domain in cache:
                    record = cache[domain]
                    yield domain, record["status"], "cache", record["checked_at"]
                else:
                    yield domain, "unknown (skipped after rate limit)", "skipped", ""
            return


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--style", choices=PRESETS, default="calm")
    parser.add_argument("--count", type=int, default=200, help="candidates per page (default: 200)")
    parser.add_argument("--seed", type=int, default=42, help="reproducible sequence seed (default: 42)")
    parser.add_argument("--length", type=int, help="exact character count; defaults: calm 6, flowing 5, expansive 7")
    parser.add_argument("--list-variants", action="store_true", help="show styles, letters, and allowed lengths")
    parser.add_argument("--page", type=int, default=1, help="1-based page in the seeded sequence (default: 1)")
    parser.add_argument("--check-com", action=argparse.BooleanOptionalAction, default=True,
                        help="check .com registration (default: enabled; use --no-check-com to skip)")
    parser.add_argument("--hide-registered", "--exclude-registered", action="store_true",
                        help="hide registered domains within this page; unknown results remain visible")
    parser.add_argument("--cache", type=Path, default=Path(__file__).resolve().with_name("domain_cache.json"),
                        help="cache file (default: domain_cache.json beside this script)")
    parser.add_argument("--refresh", action="store_true", help="repeat lookups instead of using cached results")
    args = parser.parse_args()
    if args.hide_registered and not args.check_com:
        parser.error("--hide-registered requires .com checking")
    if args.list_variants:
        for style, config in PRESETS.items():
            vowel_first = config["pattern"].startswith("V")
            lengths = range(3 if vowel_first else 2, 2 * len(set(config["consonants"])) + int(vowel_first) + 1, 2)
            print(f"{style}: default {config['pattern']} ({len(config['pattern'])} chars); "
                  f"lengths {', '.join(map(str, lengths))}; consonants {config['consonants']}; "
                  f"endings {config['endings']}")
        return
    try:
        names = generate(args.style, args.count, args.seed, args.length, args.page)
    except ValueError as error:
        parser.error(str(error))
    capacity = name_space(args.style, args.length)[3]
    pages = (capacity + args.count - 1) // args.count
    print(f"seed={args.seed} style={args.style} length={args.length or len(PRESETS[args.style]['pattern'])} "
          f"page={args.page}/{pages} total_names={capacity:,} page_size={args.count} candidates={len(names)}", file=sys.stderr)
    if not args.check_com:
        print("\n".join(names))
        return
    print("domain\tstatus\tsource\tchecked_at_utc", flush=True)
    try:
        for result in domain_results(names, args.cache, args.refresh):
            if not args.hide_registered or result[1] != "registered":
                print("\t".join(result), flush=True)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Cache error: {error}\n")
    print("RDAP absence does not guarantee registration availability. Cached results persist until --refresh.", file=sys.stderr)


if __name__ == "__main__":
    main()
