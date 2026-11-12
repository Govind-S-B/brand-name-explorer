"""Compare completion time with recoverable faults; no network requests are made."""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import domain_lookup


def run(module):
    calls = Counter()
    lock = threading.Lock()
    def provider(domain):
        index = int(domain.removeprefix('name').removesuffix('.com'))
        with lock:
            calls[domain] += 1
            attempt = calls[domain]
        time.sleep(.5 if index == 0 and attempt == 1 else .005)
        if index % 10 == 0 and attempt == 1:
            return module.Result(error='connection reset', retryable=True)
        return module.Result(status='registered')
    with tempfile.TemporaryDirectory() as folder, patch.object(module.RdapClient, 'get', side_effect=provider), \
            patch.object(module.random, 'uniform', return_value=0):
        lookup = module.DomainLookup(Path(folder)/'cache.db', workers=8, rate=20, **({"dns": False} if hasattr(module, "DohResolver") else {}))
        lookup.limiter.maximum = lookup.limiter.rate = 100000  # local simulated provider only
        started = time.monotonic()
        rows = list(lookup.many(f'name{i}.com' for i in range(600)))
        elapsed = time.monotonic()-started
        assert [r[0] for r in rows] == [f'name{i}.com' for i in range(600)]
        assert len(module.load_cache(Path(folder)/'cache.db')) == 600
        return dict(seconds=elapsed, completed=len(rows), attempts=lookup.requests, retries=lookup.retries)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-path', type=Path)
    args = parser.parse_args()
    if args.baseline_path:
        spec = importlib.util.spec_from_file_location('baseline_lookup', args.baseline_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        print(json.dumps({'baseline': run(module)}), flush=True)
    print(json.dumps({'current': run(domain_lookup)}), flush=True)
