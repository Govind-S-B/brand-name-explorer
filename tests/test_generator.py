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

    def test_count_does_not_change_sequence(self):
        first = g.generate(count=7, page=1)
        second = g.generate(count=7, page=2)
        self.assertEqual(first + second, g.generate(count=14))

    def test_registry_http_responses(self):
        for code, expected in [(404, 'possibly available'), (429, 'unknown (rate limited)'),
                               (500, 'unknown (HTTP 500)')]:
            with patch.object(g, 'urlopen', side_effect=HTTPError('url', code, '', {}, None)):
                self.assertEqual(g.check_com('example.com'), expected)


class BrowseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name) / 'domain_cache.json'
        self.names = list(g.ordered_names('calm', 42, 2))
        self.domains = [name.lower() + '.com' for name in self.names]
        self.statuses = {domain: 'registered' if index % 2 == 0 else 'possibly available'
                         for index, domain in enumerate(self.domains)}
        self.check = patch.object(g, 'check_com', side_effect=lambda domain: self.statuses[domain]).start()
        self.addCleanup(patch.stopall)
        patch.object(g.time, 'sleep').start()

    def session(self, refresh=False):
        return g.BrowseSession(self.cache, 'calm', 42, 2, refresh)

    def test_pages_resume_without_duplicate_lookups(self):
        first = list(self.session().page(3, 1))
        self.assertEqual([r[0] for r in first], self.domains[1:6:2])
        self.assertEqual(self.check.call_count, 6)
        second = list(self.session().page(3, 2))
        self.assertEqual([r[0] for r in second], self.domains[7:12:2])
        self.assertEqual(self.check.call_count, 12)
        again = list(self.session().page(3, 1))
        self.assertEqual([r[0] for r in again], [r[0] for r in first])
        self.assertEqual(self.check.call_count, 12)
        self.assertEqual(len({r[0] for r in first + second}), 6)
        resized = list(self.session().page(6, 1))
        self.assertEqual([r[0] for r in resized], [r[0] for r in first + second])
        self.assertEqual(self.check.call_count, 12)

    def test_jump_to_later_page_and_exhaustion(self):
        session = self.session()
        last = list(session.page(5, 3))
        self.assertEqual([r[0] for r in last], self.domains[21::2])
        self.assertEqual(self.check.call_count, 28)
        self.assertIn('page=3/3', session.summary(5, 3))
        self.assertEqual(list(self.session().page(5, 4)), [])
        self.assertEqual(self.check.call_count, 28)

    def test_existing_global_cache_is_reused(self):
        lookup = g.DomainLookup(self.cache)
        for domain in self.domains[:6]:
            lookup.get(domain)
        self.check.reset_mock()
        rows = list(self.session().page(3, 1))
        self.assertEqual(len(rows), 3)
        self.check.assert_not_called()

    def test_failed_lookup_retries_and_resumes_same_position(self):
        failed = self.domains[4]
        def check(domain):
            return 'unknown (rate limited)' if domain == failed else self.statuses[domain]
        self.check.side_effect = check
        session = self.session()
        displayed = []
        with self.assertRaises(g.LookupFailure):
            for row in session.page(3, 1):
                displayed.append(row)
        self.assertEqual(len(displayed), 2)
        self.assertEqual(self.check.call_count, 7)
        self.assertNotIn(failed, g.load_cache(self.cache))
        resumed = self.session()
        self.assertEqual(resumed.state['cursor'], 4)
        self.check.reset_mock()
        self.check.side_effect = lambda domain: self.statuses[domain]
        complete = list(resumed.page(3, 1))
        self.assertEqual(len(complete), 3)
        self.assertEqual(self.check.call_args_list[0].args[0], failed)
        self.assertEqual(self.check.call_count, 2)

    def test_refresh_rebuilds_but_normal_browsing_is_stable(self):
        original = list(self.session().page(2, 1))
        self.statuses[self.domains[1]] = 'registered'
        lookup = g.DomainLookup(self.cache)
        lookup.get(self.domains[1], fresh_since='9999')
        stable = list(self.session().page(2, 1))
        self.assertEqual([r[0] for r in stable], [r[0] for r in original])
        self.check.reset_mock()
        refreshed = list(self.session(refresh=True).page(2, 1))
        self.assertEqual([r[0] for r in refreshed], [self.domains[3], self.domains[5]])
        self.assertEqual(self.check.call_count, 6)
        self.check.reset_mock()
        list(self.session().page(2, 1))
        self.check.assert_not_called()

    def test_interrupted_refresh_keeps_freshness_requirement(self):
        list(self.session().page(3, 1))
        self.check.side_effect = lambda domain: ('unknown (lookup failed)' if domain == self.domains[2]
                                                else self.statuses[domain])
        with self.assertRaises(g.LookupFailure):
            list(self.session(refresh=True).page(3, 1))
        self.check.reset_mock()
        self.check.side_effect = lambda domain: self.statuses[domain]
        list(self.session().page(3, 1))
        self.assertEqual(self.check.call_args_list[0].args[0], self.domains[2])
        self.assertEqual(self.check.call_count, 4)

    def run_cli(self, flags):
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.argv', ['name_generator.py', '--cache', str(self.cache)] + flags), \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            g.main()
        return out.getvalue(), err.getvalue()

    def test_defaults(self):
        args = g.build_parser().parse_args([])
        self.assertEqual((args.style, args.seed, args.count, args.page), ('calm', 42, 200, 1))
        self.assertEqual(len(g.name_space(args.style, args.length)[0]), 6)
        self.assertTrue(args.check_com and args.hide_registered)

    def test_cli_filter_off_checks_only_requested_page(self):
        out, err = self.run_cli(['--length', '2', '--no-hide-registered', '--count', '3', '--page', '2'])
        self.assertEqual([c.args[0] for c in self.check.call_args_list], self.domains[3:6])
        self.assertEqual(len(out.splitlines()), 4)
        self.assertIn('page=2/10', err)
        self.assertFalse(self.cache.with_name('domain_cache_sessions').exists())

    def test_cli_no_lookup_bypasses_default_filter_and_state(self):
        out, err = self.run_cli(['--no-check-com', '--count', '3', '--page', '2'])
        self.check.assert_not_called()
        self.assertEqual(out.splitlines(), g.generate(count=3, page=2))
        self.assertFalse(self.cache.exists())
        self.assertIn('page=2/7000', err)

    def test_cli_filter_fills_page(self):
        out, err = self.run_cli(['--length', '2', '--count', '3', '--page', '2'])
        self.assertEqual([line.split('\t')[0] for line in out.splitlines()[1:]], self.domains[7:12:2])
        self.assertIn('page=2/?', err)
        self.assertEqual(self.check.call_count, 12)

    def test_cli_failure_is_error_not_domain_row(self):
        self.check.side_effect = None
        self.check.return_value = 'unknown (lookup failed)'
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.argv', ['name_generator.py', '--cache', str(self.cache)]), \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as exit:
                g.main()
        self.assertEqual(exit.exception.code, 1)
        self.assertEqual(len(out.getvalue().splitlines()), 1)
        self.assertIn('after 3 attempts', err.getvalue())
        self.assertEqual(self.check.call_count, 3)


if __name__ == '__main__':
    unittest.main()
