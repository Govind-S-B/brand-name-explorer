"""Measure calm/6/seed-42 filtered lookup using a new, empty local cache.

Example: python3 scripts/benchmark_lookup.py --count 200 --out .cache/bench-200
The output directory must not exist; production caches are never read.
"""

import argparse
import concurrent.futures
import json
import math
import statistics
import sys
import threading
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from name_generator import BrowseSession, build_parser
from sound_profiles import MoodSpace


def main():
    defaults = build_parser().parse_args([])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, default=200)
    parser.add_argument('--page', type=int, default=1)
    parser.add_argument('--workers', type=int, default=defaults.lookup_workers)
    parser.add_argument('--rate', type=float, default=defaults.lookup_rate)
    parser.add_argument('--experimental-rate', action='store_true',
                        help='enable conservative pressure-stop guards for exploratory runs')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--no-dns', action='store_true', help='RDAP-only comparison with the same scheduler')
    args = parser.parse_args()
    if args.count < 1 or args.page < 1:
        parser.error('--count and --page must be positive')
    if not math.isfinite(args.rate) or not 0 < args.rate <= (640 if args.experimental_rate else 320):
        parser.error('rate must be >0 and <=320 (<=640 with --experimental-rate)')
    if not 1 <= args.workers <= (128 if args.experimental_rate else 64):
        parser.error('workers must be 1–64 (up to 128 with --experimental-rate)')
    args.out.mkdir(parents=True, exist_ok=False)
    session = BrowseSession(args.out / 'cache.json',
                            space=MoodSpace('calm', length=6, seed=42),
                            workers=min(args.workers, 64), rate=min(args.rate, 320))
    lookup = session.lookup
    lookup.dns_enabled = not args.no_dns
    if args.workers != lookup.workers:
        lookup.pool.shutdown()
        lookup.workers = args.workers
        lookup.active_limit = args.workers
        lookup.pool = concurrent.futures.ThreadPoolExecutor(max_workers=args.workers, thread_name_prefix='rdap-bench')
    lookup.limiter.maximum = args.rate
    original = lookup.client.get
    lock = threading.Lock()
    latencies = []
    outcomes = Counter()
    requests = []
    active = peak_active = 0
    pressure = None
    slow_streak = max_slow_streak = 0
    latency_windows = []
    started = time.monotonic()
    cpu_started = time.process_time()

    def measured(domain):
        nonlocal active, peak_active, pressure, slow_streak, max_slow_streak
        start = time.monotonic()
        rate = lookup.limiter.rate
        with lock:
            active += 1
            peak_active = max(peak_active, active)
        try:
            result = original(domain)
        finally:
            with lock:
                active -= 1
        elapsed = time.monotonic() - start
        with lock:
            latencies.append(elapsed)
            outcomes[result.status or result.error] += 1
            requests.append({'start': start - started, 'seconds': elapsed,
                             'rate': rate, 'outcome': result.status or result.error, 'failure_phase': result.phase})
            if args.experimental_rate:
                if result.throttled or result.retry_after or result.provider_failure or (result.error and not result.retryable):
                    pressure = pressure or result.error
                errors = sum(not r['outcome'] in ('registered', 'possibly available') for r in requests[-100:])
                if len(requests) >= 100 and errors > 2:
                    pressure = pressure or 'more than 2% failed attempts in last 100 requests'
                if len(latencies) % 100 == 0:
                    p95 = sorted(latencies[-100:])[95]
                    latency_windows.append(p95)
                    slow_streak = slow_streak + 1 if p95 > 1 else 0
                    max_slow_streak = max(max_slow_streak, slow_streak)
                    if slow_streak >= 3:
                        pressure = pressure or 'HTTP p95 exceeded 1 second for three consecutive 100-request windows'
                if pressure:
                    lookup.limiter.stop()
        return result

    lookup.client.get = measured
    dns_samples = []
    dns_outcomes = Counter()
    dns_active = dns_peak = 0
    original_dns = lookup.resolver.get if lookup.dns_enabled else None

    def measured_dns(domain):
        nonlocal dns_active, dns_peak
        start = time.monotonic()
        with lock:
            dns_active += 1
            dns_peak = max(dns_peak, dns_active)
        try:
            result = original_dns(domain)
        finally:
            with lock:
                dns_active -= 1
        with lock:
            dns_outcomes[result.outcome if not result.error else result.error] += 1
            dns_samples.append(dict(domain=domain, start=start-started, seconds=time.monotonic()-start,
                                    outcome=result.outcome, error=result.error, ttl=result.ttl))
        return result

    if lookup.dns_enabled:
        lookup.resolver.get = measured_dns
    stop = threading.Event()

    def progress():
        while not stop.wait(10):
            with lock:
                counts = dict(outcomes)
            print(json.dumps({
                'elapsed': round(time.monotonic() - started, 1),
                'cursor': session.state['cursor'],
                'available': len(session.state['matches']),
                'attempts': lookup.requests,
                'rate': lookup.limiter.rate,
                'doh_queries': lookup.dns_requests,
                'rdap_avoided': lookup.rdap_avoided,
                'outcomes': counts,
            }), flush=True)

    thread = threading.Thread(target=progress, daemon=True)
    thread.start()
    rows, error = [], None
    stream = session.page(args.count, args.page)
    try:
        rows.extend(stream)
    except (Exception, KeyboardInterrupt) as failure:
        error = repr(failure)
    finally:
        stream.close()
        lookup.close()
        stop.set()
        thread.join()

    ordered = sorted(latencies)
    at_ceiling = [request for request in requests if request['rate'] >= args.rate]
    ceiling_span = (max(r['start'] + r['seconds'] for r in at_ceiling)
                    - min(r['start'] for r in at_ceiling)) if at_ceiling else 0
    result = {
        'count': args.count, 'page': args.page,
        'workers': args.workers, 'rate_ceiling': args.rate,
        'experimental_rate': args.experimental_rate,
        'elapsed_seconds': round(time.monotonic() - started, 3),
        'cpu_seconds': round(time.process_time() - cpu_started, 3),
        'displayed': len(rows), 'cursor': session.state['cursor'],
        'matches': len(session.state['matches']),
        'requests': lookup.requests, 'cache_hits': lookup.hits,
        'dns_enabled': lookup.dns_enabled,
        'doh_queries': lookup.dns_requests, 'rdap_avoided': lookup.rdap_avoided,
        'doh_cache_hits': lookup.dns_hits, 'doh_errors': lookup.dns_errors,
        'doh_throttles': lookup.dns_throttles, 'doh_outcomes': dict(dns_outcomes),
        'doh_peak_active': dns_peak, 'doh_samples': dns_samples,
        'doh_latency_p50': statistics.median([s['seconds'] for s in dns_samples]) if dns_samples else None,
        'doh_latency_p95': sorted(s['seconds'] for s in dns_samples)[min(len(dns_samples)-1, int(.95*len(dns_samples)))] if dns_samples else None,
        'retries': lookup.retries, 'outcomes': dict(outcomes),
        'peak_active_http': peak_active,
        'congestion_events': lookup.congestion_events,
        'final_concurrency': lookup.active_limit,
        'dns_queries': lookup.client.dns_queries,
        'dns_cache_hits': lookup.client.dns_hits,
        'stopped_on_pressure': pressure,
        'latency_guard_windows': 3,
        'max_slow_streak': max_slow_streak,
        'latency_windows_p95': latency_windows,
        'ceiling_attempts_per_second': round(len(at_ceiling) / ceiling_span, 3) if ceiling_span else None,
        'request_samples': requests,
        'latency_p50': round(statistics.median(ordered), 4) if ordered else None,
        'latency_p95': round(ordered[min(len(ordered)-1, int(.95*len(ordered)))], 4) if ordered else None,
        'error': error, 'domains': [row[0] for row in rows],
    }
    (args.out / 'result.json').write_text(json.dumps(result, indent=2))
    print('RESULT ' + json.dumps({key: value for key, value in result.items()
                                 if key not in ('domains', 'request_samples', 'doh_samples')}), flush=True)
    return 1 if error else 0


if __name__ == '__main__':
    sys.exit(main())
