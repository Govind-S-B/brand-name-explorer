"""RDAP-confirm a seeded random sample of DNS positives from a completed benchmark.

Uses a separate empty cache; never reuses the DNS registration decision.
Example: python3 scripts/verify_dns.py --benchmark .cache/doh-after-4000-live --out .cache/doh-verify
"""
import argparse
from collections import Counter
from contextlib import closing
import json
from pathlib import Path
import random
import sqlite3
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain_lookup import DomainLookup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--benchmark', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--sample', type=int, default=200)
    parser.add_argument('--seed', type=int, default=20261112)
    args = parser.parse_args()
    if args.sample < 200:
        parser.error('--sample must be at least 200')
    with closing(sqlite3.connect(args.benchmark / 'cache.sqlite3')) as db:
        positives = [r[0] for r in db.execute("SELECT domain FROM dns WHERE outcome='ns' ORDER BY domain")]
        negatives = [dict(domain=d, dns=o, rdap=s) for d, o, s in db.execute(
            "SELECT dns.domain,dns.outcome,domains.status FROM dns JOIN domains USING(domain) WHERE dns.outcome!='ns' ORDER BY domain")]
    if len(positives) < args.sample:
        parser.error(f'only {len(positives)} DNS positives to sample')
    sample = random.Random(args.seed).sample(positives, args.sample)
    args.out.mkdir(parents=True, exist_ok=False)
    lookup = DomainLookup(args.out / 'cache.sqlite3', dns=False)
    started = time.monotonic()
    rows, error = [], None
    try:
        rows.extend(lookup.many(sample))
    except Exception as failure:
        error = repr(failure)
    finally:
        lookup.close()
    mismatches = [row for row in rows if row[1] != 'registered']
    negative_registered = [r for r in negatives if r['rdap'] == 'registered']
    result = dict(seed=args.seed, population=len(positives), requested=args.sample,
                  confirmed=len(rows), mismatches=mismatches, error=error,
                  seconds=time.monotonic()-started, rdap_requests=lookup.requests,
                  retries=lookup.retries, cache_hits=lookup.hits,
                  dns_negative_rdap_statuses=dict(Counter((r['dns'] + ' / ' + r['rdap']) for r in negatives)),
                  dns_negative_registered=negative_registered, rdap_sample=rows)
    (args.out / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({k:v for k,v in result.items() if k not in ('rdap_sample', 'dns_negative_registered')}))
    return int(bool(error or mismatches or len(rows) != args.sample))


if __name__ == '__main__':
    sys.exit(main())
