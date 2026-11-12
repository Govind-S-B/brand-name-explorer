import contextlib
import io
import itertools
import math
import shlex
import unittest
from unittest.mock import patch

import name_generator as generator
import reverse_finder as reverse
import inverter
from pronunciation import read_reference
from sound_profiles import MOODS, MoodSpace


class ReverseFinderTests(unittest.TestCase):
    def test_generated_words_parse_and_fit_their_exact_structure(self):
        for mood in MOODS:
            for word in itertools.islice(MoodSpace(mood).names(), 20):
                parsed = inverter.parse_spelling(word)
                space = MoodSpace(mood, **parsed['structure'])
                self.assertEqual(''.join(parsed['parts']), word.lower())
                self.assertTrue(math.isfinite(inverter.log_probability(space, parsed['parts'])))

    def test_single_sounds_clusters_and_vowel_digraphs(self):
        self.assertEqual(inverter.parse_spelling('shashi')['structure']['opening'], 'consonant')
        self.assertEqual(inverter.parse_spelling('brana')['structure']['opening'], 'cluster')
        self.assertEqual(inverter.parse_spelling('chairo')['parts'], ['ch', 'ai', 'r', 'o'])

    def test_structure_and_unsupported_readings(self):
        parsed = inverter.parse_spelling('  Oom  ')
        self.assertEqual(parsed['parts'], ['oo', 'm'])
        self.assertEqual(parsed['structure'], dict(length=3, syllables=1, opening='vowel', ending='closed'))
        for word in ('', 'x', 'a' * 15, 'café', 'foo.com', 'zudio', 'oosh', 'banana!'):
            with self.assertRaises(ValueError, msg=word):
                inverter.parse_spelling(word)

    def test_probabilities_normalize_over_small_constrained_space(self):
        space = MoodSpace(length=3, opening='consonant', syllables=1, ending='open',
                          energy=8, weight=2, novelty=7)
        total = sum(math.exp(inverter.log_probability(space, inverter.parse_spelling(word)['parts']))
                    for word in space.names())
        self.assertAlmostEqual(total, 1, places=10)

    def test_fit_is_deterministic_improves_neutral_and_emits_valid_commands(self):
        parsed = inverter.parse_spelling('lemoru')
        fits = inverter.fit_profiles(parsed)
        self.assertEqual(len(fits), 1331)
        self.assertEqual(fits, inverter.fit_profiles(parsed))
        neutral = inverter.log_probability(MoodSpace(**parsed['structure'], energy=5, weight=5, novelty=5),
                                          parsed['parts'])
        self.assertGreater(fits[0][0], neutral)
        for score, dials in fits[:3]:
            args = generator.build_parser().parse_args(shlex.split(reverse.generator_command(parsed['structure'], dials, 123))[2:])
            self.assertEqual(args.seed, 123)
            self.assertFalse(args.check_com)
            for key, value in {**parsed['structure'], **dials}.items():
                self.assertEqual(getattr(args, key), value)

    def test_cli_is_offline_with_explicit_engine_spelling(self):
        with patch('sys.argv', ['reverse_finder.py', 'lemoru', '--reading', 'lemoru']), \
             patch.object(generator, 'DomainLookup', side_effect=AssertionError('unexpected lookup')), \
             patch('builtins.open', side_effect=AssertionError('unexpected disk access')), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            reverse.main()
        text = output.getvalue()
        self.assertIn('Reference: lemoru', text)
        self.assertIn('L EH M OW R UW', text)
        self.assertIn('not confidence intervals', text)
        self.assertIn('--no-check-com', text)

    def test_generated_spellings_round_trip_to_generator_projection(self):
        for mood in MOODS:
            for word in itertools.islice(MoodSpace(mood).names(), 30):
                pronunciation = read_reference(word, reading=word)
                parsed, gaps = inverter.generator_projection(pronunciation, word.lower())
                self.assertEqual(gaps, [], word)
                self.assertEqual(parsed['reading'], word.lower())
                self.assertEqual(inverter.spelling_phone_sequence(parsed), pronunciation.phones)

    def test_corrected_reference_readings_preserve_syllables(self):
        cases = [('zafkiel', 'zaf-ki-el', ('Z','AA','F','K','IY','EH','L'), 3),
                 ('shien', 'she-en', ('SH','IY','EH','N'), 2),
                 ('giorno', 'jee-orn-o', ('JH','IY','AO','R','N','OW'), 3)]
        for word, reading, phones, syllables in cases:
            p = read_reference(word, reading=reading)
            self.assertEqual(p.phones, phones)
            self.assertEqual(p.structure['syllables'], syllables)
            result = reverse.report(word, reading)
            self.assertEqual(result['status'], 'gap')
            self.assertEqual(result['candidates'], [])
            self.assertTrue(any('hiatus' in gap for gap in result['gaps']))

    def test_dictionary_corrects_silent_letter_and_reports_alternatives(self):
        p = read_reference('valve')
        self.assertEqual(p.phones, ('V','AE1','L','V'))
        self.assertEqual(p.structure, dict(syllables=1, opening='consonant', ending='closed'))
        self.assertTrue(read_reference('rudolf').alternatives)

    def test_all_stress_test_inputs_report_specific_gaps_or_valid_fit(self):
        for word, expected in [('rudolf', 'L F'), ('himmel', 'AH'), ('fern', 'ER'),
                               ('testarossa', 'S S'), ('valve', 'L V')]:
            result = reverse.report(word)
            self.assertEqual(result['status'], 'gap')
            self.assertEqual(result['candidates'], [])
            self.assertTrue(any(expected in gap for gap in result['gaps']), result)
        result = reverse.report('figma')
        self.assertEqual(result['status'], 'fit')
        self.assertEqual(len(result['candidates']), 3)
        for candidate in result['candidates']:
            args = generator.build_parser().parse_args(shlex.split(candidate['command'])[2:])
            space = MoodSpace(mood=args.mood, energy=args.energy, weight=args.weight,
                              novelty=args.novelty, length=args.length, syllables=args.syllables,
                              opening=args.opening, ending=args.ending, seed=args.seed)
            self.assertEqual(candidate['samples'], list(itertools.islice(space.names(), 5)))

    def test_no_partial_fit_or_silent_substitution(self):
        for word, kwargs in [('valve', {}), ('fuchsia', {'reading':'fusha'}),
                              ('xyz', {'phones':'AH'}), ('lemoru', {'phones':'L EH1 M OW0 R UW0'}),
                              ('abc', {'reading':'lem'})]:
            with patch.object(inverter, 'fit_profiles', side_effect=AssertionError('must not fit gaps')):
                result = reverse.report(word, **kwargs)
            self.assertEqual(result['status'], 'gap')
            self.assertEqual(result['candidates'], [])

    def test_gap_json_and_exit_code(self):
        import json
        with patch('sys.argv', ['reverse_finder.py', 'shien', '--reading', 'she-en', '--json']), \
             contextlib.redirect_stdout(io.StringIO()) as output, \
             self.assertRaises(SystemExit) as error:
            reverse.main()
        self.assertEqual(error.exception.code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'gap')
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['syllable_boundaries'], [2])

    def test_phonetic_input_validation_and_precedence(self):
        self.assertEqual(read_reference('valve', phones='V AE L V').phones, ('V','AE','L','V'))
        for kwargs in ({'phones':'V9 AA'}, {'phones':'V1 AA'}, {'phones':'INVALID'},
                       {'reading':''}, {'reading':'she--en', 'phones':'SH IY EH N'},
                       {'reading':'x; echo bad'}, {'reading':'s'}, {'phones':'K'}):
            with self.assertRaises(ValueError):
                read_reference('example', **kwargs)
        result = reverse.report('lemoru', reading='lemoru')
        other = reverse.report('lemoru', reading='lemoru', seed=99)
        self.assertEqual([c['dials'] for c in result['candidates']], [c['dials'] for c in other['candidates']])
        self.assertNotEqual(result['candidates'][0]['samples'], other['candidates'][0]['samples'])


if __name__ == '__main__':
    unittest.main()
