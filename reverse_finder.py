#!/usr/bin/env python3
"""Invert the current generator, or report why a reference cannot be represented.

Examples:
    python3 reverse_finder.py lemoru
    python3 reverse_finder.py Zafkiel --reading zaf-ki-el
    python3 reverse_finder.py Shien --reading she-en
    python3 reverse_finder.py Giorno --reading jee-orn-o

Offline; no domain lookups or cache writes. Exit 1 means a representation gap.
"""

import argparse
import itertools
import json
import shlex

from inverter import invert
from pronunciation import read_reference
from sound_engine import DIALS
from sound_profiles import MOODS, MoodSpace
from substitutions import suggest


def closest_recipe(dials):
    return min(MOODS, key=lambda mood: sum((MOODS[mood][d] - dials[d]) ** 2 for d in DIALS))


def generator_command(structure, dials, seed):
    args = ['python3', 'name_generator.py', '--mood', closest_recipe(dials)]
    for key, value in dials.items():
        args += ['--' + key, str(value)]
    for key in ('opening', 'syllables', 'ending', 'length'):
        args += ['--' + key, str(structure[key])]
    return shlex.join(args + ['--seed', str(seed), '--no-check-com', '--count', '20', '--page', '1'])


def report(word, reading=None, phones=None, seed=42, substitutions=0):
    if not isinstance(substitutions, int) or not 0 <= substitutions <= 20:
        raise ValueError('--substitutions must be from 1 to 20 (or omitted)')
    pronunciation = read_reference(word, reading, phones)
    inverse = invert(pronunciation, word)
    result = dict(reference=word, status='gap' if inverse.gaps else 'fit',
                  source=pronunciation.source, phones=list(pronunciation.phones),
                  syllable_boundaries=list(pronunciation.boundaries),
                  reading_notes=list(pronunciation.notes), alternatives=list(pronunciation.alternatives),
                  structure=inverse.structure, gaps=inverse.gaps, candidates=[], ranges={})
    if substitutions:
        result['substitutions'] = suggest(pronunciation, word, substitutions)
    if inverse.gaps:
        return result
    # Each candidate is a valid configuration of the same forward generator.
    best = inverse.fits[0][0]
    nearby = [d for score, d in inverse.fits if best - score <= .1]
    result['ranges'] = {d: [min(p[d] for p in nearby), max(p[d] for p in nearby)] for d in DIALS}
    for score, dials in inverse.fits[:3]:
        space = MoodSpace(**inverse.generation, **dials, seed=seed)
        result['candidates'].append(dict(dials=dials, nearest_recipe=closest_recipe(dials),
                                         fit_gap=round(best-score, 6),
                                         samples=list(itertools.islice(space.names(), 5)),
                                         command=generator_command(inverse.generation, dials, seed)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('word', help='reference name; dictionary lookup precedes spelling fallback')
    pronunciation = parser.add_mutually_exclusive_group()
    pronunciation.add_argument('--reading', help='engine spelling, or hyphenated syllables such as she-en')
    pronunciation.add_argument('--phones', help='explicit ARPABET sounds, e.g. "SH IY EH N"; stress digits optional')
    parser.add_argument('--seed', type=int, default=42, help='sample generation seed, not a fitting input (default: 42)')
    parser.add_argument('--json', action='store_true', help='machine-readable report with status fit or gap')
    parser.add_argument('--substitutions', type=int, metavar='N', default=0,
                        help='opt in to 1–20 nearby allowed words; original fit/gap status is unchanged')
    args = parser.parse_args()
    try:
        result = report(args.word, args.reading, args.phones, args.seed, args.substitutions)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f'Reference: {result["reference"]}')
        print(f'Reading source: {result["source"]}')
        print('Sounds (ARPABET): ' + ' '.join(result['phones']))
        print('Structure: ' + ' '.join(f'{k}={v}' for k,v in result['structure'].items()))
        for note in result['reading_notes']:
            print('Reading note: ' + note)
        for alternative in result['alternatives']:
            print('Alternative reading: ' + alternative)
        if result['status'] == 'gap':
            print('\nGAP — the generator cannot represent this reference under the stated reading:')
            for gap in result['gaps']:
                print('  - ' + gap)
            print('No inverse settings for the original. The generator must represent these properties first.')
        else:
            print('\nFIT — candidate inverse configurations, not recovered original settings or emotion ratings.')
            ranges = ' '.join(f'{d}={lo}–{hi}' for d,(lo,hi) in result['ranges'].items())
            print('Near-best grid ranges (within 0.1 fit score; not confidence intervals): ' + ranges)
            print('Ranges are marginal; their endpoints need not fit well together.')
            for index, candidate in enumerate(result['candidates'], 1):
                print(f'\n{index}. ' + ' '.join(f'{d}={v}' for d,v in candidate['dials'].items()) +
                      f'; nearest dial recipe={candidate["nearest_recipe"]}; fit gap={candidate["fit_gap"]:.3f}')
                print('   Samples: ' + ', '.join(candidate['samples']))
                print('   ' + candidate['command'])
            print('\nOne word cannot identify a unique recipe or original seed. Reading assumptions remain unvalidated.')
        if 'substitutions' in result:
            suggestions = result['substitutions']
            print('\nOptional substitutions — alternatives, not successful inversions of the original:')
            print(suggestions['method'])
            print(f'Search: lengths {suggestions["searched_lengths"]}; vowel-group counts {suggestions["searched_syllables"]}.')
            print('Cost: insert/delete=1; change within vowels or consonant manner=0.5; other change=1.')
            print('Lower is closer under this heuristic, not a measured feeling or pronunciation similarity.')
            for note in suggestions['relaxed']:
                print('Relaxed: ' + note)
            for item in suggestions['results']:
                print(f'  {item["word"]} (cost {item["sound_edit_cost"]:g}): ' + ' '.join(item['phones']))
                print('    ' + ('; '.join(item['edits']) or 'Same unstressed sounds; different spelling.'))
                if item['structure_changes']:
                    print('    Structure changes: ' + '; '.join(item['structure_changes']))
                command = ['python3', 'reverse_finder.py', item['word'], '--phones', ' '.join(item['phones'])]
                print('    Inspect alternative: ' + shlex.join(command))
            print('Spellings follow engine readings. No dictionary, brand, or domain-availability filtering.')
    if result['status'] == 'gap':
        parser.exit(1)


if __name__ == '__main__':
    main()
