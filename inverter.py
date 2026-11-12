"""Inverse of the generator: fit representable inputs, report all other gaps."""

import itertools
import math
import re
from dataclasses import dataclass

from pronunciation import base, is_vowel
from sound_engine import CONSONANT_PHONES, DIALS, VOWEL_PHONES
from sound_profiles import CODAS, MIDDLES, ONSETS, VOWELS, MoodSpace


def parse_spelling(reading):
    """Parse the same alternating runs and positional inventories as MoodSpace."""
    reading = reading.strip().lower()
    if not re.fullmatch('[a-z]{3,14}', reading):
        raise ValueError('generator spelling must be 3–14 ASCII letters')
    parts = re.findall('[aeiou]+|[^aeiou]+', reading)
    sounds = []
    vowels = []
    for index, part in enumerate(parts):
        if part[0] in 'aeiou':
            if part not in VOWELS:
                raise ValueError(f'unsupported vowel group {part!r}; allowed: {", ".join(VOWELS)}')
            vowels.append(part)
        else:
            location, inventory = ('opening', ONSETS) if index == 0 else (
                ('ending', CODAS) if index == len(parts) - 1 else ('internal', MIDDLES))
            phones = dict(inventory).get(part)
            if phones is None:
                raise ValueError(f'unsupported {location} consonant group {part!r}')
            sounds.append((part, phones))
    if not 1 <= len(vowels) <= 5:
        raise ValueError('reading needs 1–5 vowel groups separated by supported consonants')
    opening = 'vowel' if parts[0][0] in 'aeiou' else (
        'consonant' if len(dict(ONSETS)[parts[0]]) == 1 else 'cluster')
    structure = dict(length=len(reading), syllables=len(vowels), opening=opening,
                     ending='open' if parts[-1][0] in 'aeiou' else 'closed')
    return dict(reading=reading, parts=parts, consonants=sounds, vowels=vowels,
                structure=structure)


def log_probability(space, parts):
    """First-draw word probability conditional on the supplied exact structure."""
    if len(space.shapes) != 1:
        raise ValueError('reverse scoring requires an exact opening, syllables, and ending')
    shape = space.shapes[0]
    if len(parts) != len(shape.slots) or sum(map(len, parts)) != space.length:
        raise ValueError('reading does not match the supplied structure')
    result = -math.log(shape.mass)
    for part, slot in zip(parts, shape.slots):
        token = next((token for token in slot if token.text == part), None)
        if token is None:
            raise ValueError(f'{part!r} does not fit the supplied structure')
        result += math.log(token.weight)
    return result


def fit_profiles(parsed):
    """Rank the integer dial grid with a mild preference for neutral settings."""
    fits = []
    for values in itertools.product(range(11), repeat=len(DIALS)):
        dials = dict(zip(DIALS, values))
        space = MoodSpace(**parsed['structure'], **dials)
        # shortcut: fixed regularization limits single-word extremes; tune on
        # held-out examples before interpreting fitted settings as perceptual scores.
        penalty = .5 * sum(((value - 5) / 5) ** 2 for value in values)
        score = log_probability(space, parsed['parts']) - penalty
        fits.append((score, dials))
    return sorted(fits, key=lambda fit: fit[0], reverse=True)


@dataclass
class Inversion:
    pronunciation: object
    structure: dict
    gaps: list
    mode: str
    fits: list
    generation: object


def generator_projection(pronunciation, preferred_spelling=None):
    """Return exact engine spelling when possible, with all representation gaps."""
    phones = tuple(map(base, pronunciation.phones))
    mapping = {phone: spelling for spelling, phone in CONSONANT_PHONES.items()}
    mapping.update({phone: spelling for spelling, phone in VOWEL_PHONES.items()})
    mapping['UW'] = 'u'
    gaps = []
    for phone in dict.fromkeys(phones):
        if phone not in mapping:
            gaps.append(f'sound {phone} is absent from the generator sound inventory')
    for left, right in zip(phones, phones[1:]):
        if is_vowel(left) and is_vowel(right):
            gaps.append('adjacent vowel nuclei (hiatus) require a consonant between them in the current grammar')
            break
    index = 0
    while index < len(phones):
        if is_vowel(phones[index]):
            index += 1
            continue
        end = index
        while end < len(phones) and not is_vowel(phones[end]):
            end += 1
        label, inventory = ('opening', ONSETS) if index == 0 else (
            ('ending', CODAS) if end == len(phones) else ('internal', MIDDLES))
        allowed = {tuple(CONSONANT_PHONES[s] for s in sounds) for _, sounds in inventory}
        if phones[index:end] not in allowed:
            gaps.append(f'{label} group {" ".join(phones[index:end])} is outside the generator grammar')
        index = end
    parsed = None
    if not gaps:
        spelling = ''.join(mapping[p] for p in phones)
        if preferred_spelling:
            try:
                candidate = parse_spelling(preferred_spelling)
                if spelling_phone_sequence(candidate) == phones:
                    spelling = preferred_spelling
            except ValueError:
                pass
        try:
            parsed = parse_spelling(spelling)
            if spelling_phone_sequence(parsed) != phones:
                gaps.append('spelling merges distinct sound tokens in the current grammar')
                parsed = None
        except ValueError as error:
            gaps.append(str(error))
    return parsed, gaps


def spelling_phone_sequence(parsed):
    consonants = dict(parsed['consonants'])
    phones = []
    for part in parsed['parts']:
        if part in VOWEL_PHONES:
            phones.append(VOWEL_PHONES[part])
        else:
            phones.extend(CONSONANT_PHONES[s] for s in consonants[part])
    return tuple(phones)


def invert(pronunciation, reference):
    reference = reference.strip().lower()
    spelling_length = len(reference)
    parsed, gaps = generator_projection(pronunciation, reference)
    structure = dict(length=spelling_length, **pronunciation.structure)
    if any(p[-1].isdigit() for p in pronunciation.phones):
        gaps.append('stress is specified by this reading but is not represented by the generator')
    if pronunciation.boundaries:
        gaps.append('explicit syllable boundaries are not represented by the generator; only vowel-group count is')
    if parsed and parsed['reading'] != reference:
        gaps.append(f'this pronunciation renders as {parsed["reading"]!r} in the engine, not {reference!r}; '
                    'alternate spelling is not supported')
    if not 3 <= spelling_length <= 14:
        gaps.append('reference spelling length is outside generator range 3–14')
    if not 1 <= structure['syllables'] <= 5:
        gaps.append('vowel-group count is outside generator range 1–5')
    if gaps:
        return Inversion(pronunciation, structure, list(dict.fromkeys(gaps)),
                         'gap: not representable', [], None)
    return Inversion(pronunciation, structure, [], 'exact generator inverse',
                     fit_profiles(parsed), parsed['structure'])
