"""Exercise lookup saturation and recovery against a simulated provider only.

No public requests are made. The simulation alone may exceed CLI rate limits.
Example: python3 scripts/stress_lookup.py --out .cache/local-stress.json
"""

import argparse
import json
import tempfile
import threading
import time
from collections import Counter, deque
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain_lookup import DomainLookup, LookupFailure, RdapClient, Result, load_cache


def run(workers, rate, count=200, delay=.2, quota=None, failure=False):
    lock = threading.Lock()
    starts = deque()
    active = peak = 0
    outcomes = Counter()
    calls = Counter()

    def provider(domain):
        nonlocal active, peak
        with lock:
            now = time.monotonic()
            while starts and starts[0] <= now - 1:
                starts.popleft()
            limited = quota is not None and len(starts) >= quota
            starts.append(now)
            calls[domain] += 1
            active += 1
            peak = max(peak, active)
        time.sleep(delay)
        with lock:
            active -= 1
            status = 'rate limited' if limited else 'HTTP 503' if failure == 'transient' else 'forbidden' if failure else 'registered'
            outcomes[status] += 1
        if limited:
            return Result(error='rate limited', retryable=True, throttled=True, retry_after=1)
        if failure == 'transient':
            return Result(error='HTTP 503', retryable=True, provider_failure=True)
        if failure:
            return Result(error='HTTP 403')
        return Result(status='registered')

    with tempfile.TemporaryDirectory() as folder, patch.object(RdapClient, 'get', side_effect=provider):
        cache = Path(folder) / 'cache.sqlite3'
        lookup = DomainLookup(cache, workers=workers, rate=min(rate, 20), dns=False)
        # Synthetic provider only: measure steady load, including beyond CLI caps.
        lookup.limiter.maximum = rate
        lookup.limiter.rate = rate
        started = time.monotonic()
        rows, error = [], None
        try:
            rows.extend(lookup.many(f'stress{i}.com' for i in range(count)))
        except LookupFailure as exc:
            error = str(exc)
        finally:
            lookup.close()
        elapsed = time.monotonic() - started
        saved = load_cache(cache)
        assert all(record['status'] == 'registered' for record in saved.values())
        assert [r[0] for r in rows] == [f'stress{i}.com' for i in range(len(rows))]
        if not failure:
            assert len(rows) == count, error
        else:
            assert not rows and not saved and error
            assert max(calls.values()) <= (3 if failure == 'transient' else 1)
        result = dict(workers=workers, rate=rate, count=count, latency=delay,
                      simulated_quota=quota, permanent_failure=failure,
                      elapsed=round(elapsed, 3), completed=len(rows),
                      completions_per_second=round(len(rows)/elapsed, 3),
                      peak_active=peak, outcomes=dict(outcomes),
                      retries=lookup.retries, final_rate=lookup.limiter.rate,
                      max_attempts_per_domain=max(calls.values(), default=0), error=error)
        print(json.dumps(result), flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    results = [run(workers, rate) for workers, rate in
               [(4, 20), (8, 20), (16, 20), (8, 40), (8, 80), (16, 40), (16, 80), (16, 160)]]
    results.append(run(8, 10, count=60, delay=.02, quota=10))
    results.append(run(8, 20, count=60, delay=.02, quota=10))
    results.append(run(8, 20, count=20, delay=.02, failure=True))
    results.append(run(8, 20, count=20, delay=.02, failure='transient'))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
