import contextlib
import io
import json
import unittest
from unittest.mock import patch

from inverter import generator_projection, parse_spelling, spelling_phone_sequence
from pronunciation import Pronunciation, base, read_reference
from reverse_finder import main, report
from substitutions import advance, edit_description, replacement_cost, suggest


class SubstitutionTests(unittest.TestCase):
    def test_distance_and_edit_trace(self):
        self.assertEqual(replacement_cost('AA', 'EH'), 1)
        self.assertEqual(replacement_cost('JH', 'CH'), 1)
        self.assertEqual(replacement_cost('AA', 'K'), 2)
        self.assertEqual(edit_description(('SH','IY','EH','N'), ('SH','IY','N')),
                         ['remove sound 3: EH'])
        self.assertEqual(edit_description(('L','M'), ('L','AA','M')),
                         ['insert AA after original sound 1'])

    def test_references_produce_only_valid_distinct_alternatives(self):
        for word, reading in [('rudolf', None), ('zafkiel', 'zaf-ki-el'), ('himmel', None),
                              ('fern', None), ('testarossa', None), ('shien', 'she-en'),
                              ('valve', None), ('figma', None), ('giorno', 'jee-orn-o')]:
            pronunciation = read_reference(word, reading)
            result = suggest(pronunciation, word, 3)
            self.assertEqual(len(result['results']), 3)
            source = tuple(map(base, pronunciation.phones))
            sounds = []
            costs = []
            for item in result['results']:
                self.assertNotEqual(item['word'].lower(), word)
                parsed = parse_spelling(item['word'])
                self.assertEqual(parsed['structure'], item['structure'])
                self.assertEqual(list(spelling_phone_sequence(parsed)), item['phones'])
                _, gaps = generator_projection(Pronunciation(tuple(item['phones']), 'suggestion'), item['word'].lower())
                self.assertEqual(gaps, [])
                row = tuple(2*i for i in range(len(source)+1))
                for phone in item['phones']:
                    row = advance(row, source, phone)
                self.assertEqual(row[-1]/2, item['sound_edit_cost'])
                costs.append(item['sound_edit_cost'])
                sounds.append(tuple(item['phones']))
            self.assertEqual(len(set(sounds)), 3)
            self.assertEqual(costs, sorted(costs))

    def test_no_implicit_substitution_or_reclassification(self):
        with patch('reverse_finder.suggest', side_effect=AssertionError('must be opt-in')):
            strict = report('valve')
        with_alternatives = report('valve', substitutions=3)
        self.assertEqual(strict, {k:v for k,v in with_alternatives.items() if k != 'substitutions'})
        self.assertEqual(with_alternatives['status'], 'gap')
        self.assertEqual(with_alternatives['candidates'], [])
        self.assertTrue(with_alternatives['substitutions']['relaxed'])

    def test_suggestions_deterministic_and_seed_independent(self):
        a = report('shien', 'she-en', substitutions=3, seed=1)
        b = report('shien', 'she-en', substitutions=3, seed=99)
        self.assertEqual(a['substitutions'], b['substitutions'])
        self.assertEqual(a['substitutions']['results'][0]['word'], 'Sheen')

    def test_gap_exit_status_preserved_with_json_suggestions(self):
        with patch('sys.argv', ['reverse_finder.py','valve','--substitutions','2','--json']), \
             contextlib.redirect_stdout(io.StringIO()) as output, \
             self.assertRaises(SystemExit) as error:
            main()
        self.assertEqual(error.exception.code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'gap')
        self.assertEqual(len(result['substitutions']['results']), 2)

    def test_count_validation(self):
        for count in (-1, 21, 1.5):
            with self.assertRaises(ValueError):
                report('valve', substitutions=count)


if __name__ == '__main__':
    unittest.main()
