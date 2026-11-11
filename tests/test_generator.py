import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import name_generator as g


class GeneratorTests(unittest.TestCase):
    def test_pages_partition_entire_small_space(self):
        expected = set(g.candidates('calm', 2))
        pages = [g.generate('calm', 9, 42, 2, page) for page in range(1, 5)]
        flat = sum(pages, [])
        self.assertEqual(len(flat), len(set(flat)))
        self.assertEqual(set(flat), expected)
        self.assertEqual(len(pages[-1]), 1)
        self.assertEqual(pages[1], g.generate('calm', 9, 42, 2, 2))
        with self.assertRaises(ValueError):
            g.generate('calm', 9, 42, 2, 5)

    def test_default_pages_and_patterns(self):
        self.assertEqual(g.name_space('calm', 6)[3], 21000)
        pages = [g.generate(page=page) for page in range(1, 4)]
        self.assertEqual(len(set(sum(pages, []))), 600)
        for word in sum(pages, []):
            word = word.lower()
            self.assertEqual(len(word), 6)
            self.assertEqual(len(set(word[::2])), 3)
            self.assertTrue(set(word[::2]) <= set('lmnsvrh'))
            self.assertTrue(set(word[1::2]) <= set('aeiou'))
            self.assertIn(word[-1], 'oaiu')
        self.assertNotEqual(pages[0], g.generate(seed=123))
        for kwargs in ({'page': 0}, {'count': 0}, {'length': 5}):
            with self.assertRaises(ValueError):
                g.generate(**kwargs)

    def test_cache_refresh_and_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'domain_cache.json'
            with patch.object(g, 'check_com', return_value='possibly available') as check:
                list(g.domain_results(['Lomira'], path))
                rows = list(g.domain_results(['Lomira'], path))
                self.assertEqual(check.call_count, 1)
                self.assertEqual(rows[0][2], 'cache')
                list(g.domain_results(['Lomira'], path, refresh=True))
                self.assertEqual(check.call_count, 2)
            with patch.object(g, 'check_com', return_value='unknown (lookup failed)') as check:
                list(g.domain_results(['Lomira'], path, refresh=True))
                list(g.domain_results(['Lomira'], path))
                self.assertEqual(check.call_count, 2)
                self.assertNotIn('lomira.com', g.load_cache(path))

    def test_registry_http_responses(self):
        for code, expected in [(404, 'possibly available'), (429, 'unknown (rate limited)'),
                               (500, 'unknown (HTTP 500)')]:
            with patch.object(g, 'urlopen', side_effect=HTTPError('url', code, '', {}, None)):
                self.assertEqual(g.check_com('example.com'), expected)

    def test_rate_limit_stops_lookups(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'domain_cache.json'
            with patch.object(g, 'check_com', return_value='unknown (rate limited)') as check:
                rows = list(g.domain_results(['Lomira', 'Neravo'], path))
            self.assertEqual(check.call_count, 1)
            self.assertEqual(rows[1][2], 'skipped')
            self.assertFalse(path.exists())

    def test_cli_defaults_and_filter(self):
        rows = [('one.com', 'registered', 'cache', 'date'),
                ('two.com', 'possibly available', 'live', 'date'),
                ('three.com', 'unknown (lookup failed)', 'live', 'date')]
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.argv', ['name_generator.py', '--hide-registered']), \
             patch.object(g, 'domain_results', return_value=iter(rows)) as checks, \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            g.main()
        self.assertEqual(len(checks.call_args.args[0]), 200)
        self.assertIn('page=1/105 total_names=21,000', err.getvalue())
        self.assertNotIn('one.com', out.getvalue())
        self.assertIn('two.com', out.getvalue())
        self.assertIn('three.com', out.getvalue())


if __name__ == '__main__':
    unittest.main()
