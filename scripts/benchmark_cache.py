"""Measure cached pagination only; synthetic records never enter the real cache."""
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain_lookup import DomainLookup
from name_generator import BrowseSession


class Space:
    settings = {'benchmark': 'cached-prefix'}
    def __init__(self, capacity):
        self.capacity = capacity
    def names(self):
        return (f'word{i}' for i in range(self.capacity))


def run(size):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'cache.db'
        lookup = DomainLookup(path)
        with lookup.db:
            lookup.db.executemany('INSERT INTO domains VALUES (?,?,?)',
                                  ((f'word{i}.com', 'possibly available' if i % 2 else 'registered', '2026')
                                   for i in range(size)))
        lookup.close()
        times = []
        for _ in range(2):
            started = time.monotonic()
            session = BrowseSession(path, space=Space(size))
            rows = list(session.page(200, size//400))
            session.lookup.close()
            times.append(time.monotonic()-started)
            assert len(rows) == 200 and session.lookup.requests == 0
            assert [r[0] for r in rows] == [f'word{i}.com' for i in range(size-399, size, 2)]
        return dict(candidates=size, available=size//2, page=size//400,
                    build_seconds=times[0], saved_page_seconds=times[1])


if __name__ == '__main__':
    print(json.dumps([run(8000), run(80000)], indent=2))
