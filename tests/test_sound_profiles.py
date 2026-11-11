import contextlib
import io
import itertools
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import name_generator as g
from sound_profiles import MOODS, MoodSpace, resolve_profile


def take(space, count):
    return list(itertools.islice(space.names(), count))


class SoundProfileTests(unittest.TestCase):
    def test_exact_length_and_unique_for_every_mood(self):
        for mood in MOODS:
            names = take(MoodSpace(mood), 300)
            self.assertEqual(len(names), 300)
            self.assertEqual(len(set(names)), 300)
            self.assertTrue(all(len(name) == 6 and name.isascii() and name.isalpha() for name in names))
            if MOODS[mood]['ending'] != 'either':
                self.assertTrue(all((n[-1] in 'aeiou') == (MOODS[mood]['ending'] == 'open') for n in names))

    def test_exhaustion_matches_exact_capacity(self):
        for ending in ('open', 'closed', 'either'):
            space = MoodSpace(length=3, syllables=1, ending=ending)
            names = list(space.names())
            self.assertEqual(len(names), space.capacity)
            self.assertEqual(len(names), len(set(names)))
        # Cover variable syllable and empty-onset branches too.
        space = MoodSpace(length=3, ending='either')
        self.assertEqual(len(set(space.names())), space.capacity)

    def test_pages_are_slices_not_separately_generated(self):
        space = MoodSpace('playful', seed=21)
        whole = take(space, 600)
        page2 = list(itertools.islice(MoodSpace('playful', seed=21).names(), 200, 400))
        self.assertEqual(page2, whole[200:400])
        self.assertEqual(len(set(whole)), 600)
        self.assertNotEqual(whole[:20], take(MoodSpace('playful', seed=22), 20))

    def test_structure_controls_and_invalid_constraints(self):
        for length in range(3, 15):
            space = MoodSpace(length=length, ending='either')
            self.assertTrue(all(len(n) == length for n in take(space, 12)))
        for kwargs in ({'length': 2}, {'length': 15}, {'syllables': 0}, {'syllables': 6},
                       {'length': 3, 'syllables': 5}, {'energy': -1}, {'weight': 11},
                       {'novelty': float('nan')}, {'energy': float('inf')},
                       {'blend': 'playful:2'}, {'blend': 'unknown:.3'}, {'blend': 'oops'}):
            with self.assertRaises(ValueError, msg=str(kwargs)):
                MoodSpace(**kwargs)

    def test_blend_then_override_and_canonical_settings(self):
        profile = resolve_profile('calm', 'bold:0.5', weight=2)
        self.assertEqual(profile, {'energy': 5.0, 'weight': 2.0, 'novelty': 3.0, 'ending': 'open'})
        a = MoodSpace('calm')
        b = MoodSpace('bold', energy=1, weight=3, novelty=2, ending='open')
        self.assertEqual(a.settings, b.settings)
        self.assertEqual(take(a, 30), take(b, 30))

    def test_dial_changes_move_observable_sound_features(self):
        # Distribution checks, not claims that listeners will feel the target mood.
        settings = dict(energy=5, weight=5, novelty=5, syllables=3, ending='open')
        for dial, letters, direction in [('energy', 'ptkvz', 1),
                                          ('weight', 'ei', -1),
                                          ('novelty', 'vz', 1)]:
            scores = []
            for endpoint in (0, 10):
                words = take(MoodSpace(**{**settings, dial: endpoint}), 600)
                total = ''.join(words).lower()
                scores.append(sum(c in letters for c in total) / len(total))
            self.assertGreater(direction * (scores[1] - scores[0]), .04, (dial, scores))

    def test_mood_sessions_resume_and_share_domain_cache(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(g.time, 'sleep'):
            cache = Path(folder) / 'domain_cache.json'
            space = MoodSpace('playful')
            names = take(space, 20)
            statuses = {n.lower() + '.com': 'registered' if i % 2 == 0 else 'possibly available'
                        for i, n in enumerate(names)}
            with patch.object(g, 'check_com', side_effect=lambda d: statuses[d]) as check:
                first_session = g.BrowseSession(cache, space=space)
                first = list(first_session.page(3, 1))
                second_session = g.BrowseSession(cache, space=MoodSpace('playful'))
                second = list(second_session.page(3, 2))
                self.assertEqual(check.call_count, 12)
                self.assertEqual(len({r[0] for r in first + second}), 6)
                resized = list(second_session.page(6, 1))
                self.assertEqual([r[0] for r in resized], [r[0] for r in first + second])
                self.assertEqual(check.call_count, 12)
                changed = g.BrowseSession(cache, space=MoodSpace('playful', energy=2))
                self.assertNotEqual(changed.path, first_session.path)
                self.assertEqual(changed.state['cursor'], 0)
                self.assertEqual(len(changed.lookup.cache), 12)

    def test_mood_failure_does_not_advance_cursor(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(g.time, 'sleep'):
            cache = Path(folder) / 'domain_cache.json'
            space = MoodSpace()
            names = take(space, 3)
            with patch.object(g, 'check_com', side_effect=['possibly available'] + ['unknown (lookup failed)'] * 3):
                session = g.BrowseSession(cache, space=space)
                with self.assertRaises(g.LookupFailure):
                    list(session.page(2, 1))
            resumed = g.BrowseSession(cache, space=MoodSpace())
            self.assertEqual(resumed.state['cursor'], 1)
            with patch.object(g, 'check_com', return_value='possibly available') as check:
                result = list(resumed.page(2, 1))
                self.assertEqual([r[0] for r in result], [n.lower() + '.com' for n in names[:2]])
                check.assert_called_once_with(names[1].lower() + '.com')

    def test_cli_inspection_and_browsing_never_look_up(self):
        for flags in (['--list-moods'], ['--list-dials'], ['--explain'],
                      ['--mood', 'bold', '--energy', '2', '--no-check-com', '--count', '5']):
            with patch('sys.argv', ['name_generator.py'] + flags), \
                 patch.object(g, 'DomainLookup', side_effect=AssertionError('unexpected lookup')), \
                 contextlib.redirect_stdout(io.StringIO()) as out, \
                 contextlib.redirect_stderr(io.StringIO()):
                g.main()
                self.assertTrue(out.getvalue())

    def test_cli_rejects_mixed_engines(self):
        with patch('sys.argv', ['name_generator.py', '--style', 'calm', '--energy', '2']), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            g.main()
        self.assertEqual(error.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
