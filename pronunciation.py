"""Offline pronunciation input, independent of the generator's allowed shapes."""

import functools
import re
from dataclasses import dataclass
from pathlib import Path


VOWEL_PHONES = frozenset('AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW'.split())
CONSONANT_PHONES = frozenset('B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH'.split())
SPELLING_PHONES = {
    'a': 'AA', 'e': 'EH', 'i': 'IH', 'o': 'OW', 'u': 'UW',
    'ee': 'IY', 'oo': 'UW', 'ai': 'EY',
    **{s.lower(): s for s in CONSONANT_PHONES if s not in ('HH', 'JH', 'NG')},
    'h': 'HH', 'j': 'JH',
}


def base(phone):
    return phone.rstrip('012')


def is_vowel(phone):
    return base(phone) in VOWEL_PHONES


@dataclass(frozen=True)
class Pronunciation:
    phones: tuple
    source: str
    notes: tuple = ()
    alternatives: tuple = ()
    boundaries: tuple = ()

    @property
    def structure(self):
        first = next(i for i, phone in enumerate(self.phones) if is_vowel(phone))
        return dict(syllables=sum(map(is_vowel, self.phones)),
                    opening='vowel' if first == 0 else 'consonant' if first == 1 else 'cluster',
                    ending='open' if is_vowel(self.phones[-1]) else 'closed')


def validate_phones(phones):
    if not 1 <= len(phones) <= 80:
        raise ValueError('pronunciation needs 1–80 sound tokens')
    for phone in phones:
        if not re.fullmatch('[A-Z]+[012]?', phone) or base(phone) not in VOWEL_PHONES | CONSONANT_PHONES:
            raise ValueError(f'unknown ARPABET sound {phone!r}')
        if phone[-1].isdigit() and not is_vowel(phone):
            raise ValueError('stress digits are allowed only on vowels')
    if not any(map(is_vowel, phones)):
        raise ValueError('pronunciation needs at least one vowel nucleus')
    return tuple(phones)


@functools.lru_cache(maxsize=1)
def dictionary():
    result = {}
    path = Path(__file__).resolve().parent / 'data' / 'cmudict' / 'cmudict.dict'
    with path.open(encoding='utf-8') as source:
        for line in source:
            word, _, reading = line.partition(' ')
            word = re.sub(r'\(\d+\)$', '', word)
            phones = tuple(reading.split('#')[0].split())
            if phones:
                result.setdefault(word, []).append(phones)
    return result


def spelling_phones(text):
    """Explicit engine spelling; no silent letters or pronunciation guessing."""
    phones = []
    while text:
        token = next((text[:size] for size in (2, 1) if text[:size] in SPELLING_PHONES), None)
        if token is None:
            raise ValueError(f'cannot read {text!r} in engine spelling; use --phones with ARPABET sounds')
        phones.append(SPELLING_PHONES[token])
        text = text[len(token):]
    return tuple(phones)


def read_reference(word, reading=None, phones=None):
    if not word.strip() or len(word) > 80 or not word.isprintable():
        raise ValueError('word must be a printable, nonempty label of at most 80 characters')
    if reading is not None and phones is not None:
        raise ValueError('choose either --reading or --phones')
    if phones is not None:
        return Pronunciation(validate_phones(phones.upper().split()), 'supplied ARPABET')
    if reading is not None:
        reading = reading.strip().lower()
        if not re.fullmatch('[a-z]+(?:[ -]+[a-z]+)*', reading) or len(reading) > 120:
            raise ValueError('reading must use letters and optional spaces/hyphens between syllables')
        chunks = re.split('[ -]+', reading)
        # Hyphenated plain-language syllables resolve common chunks such as she
        # and jee through CMU; unsegmented readings retain engine-spelling semantics.
        sounds, boundaries, notes = [], [], []
        for chunk in chunks:
            choices = dictionary().get(chunk, ()) if len(chunks) > 1 else ()
            single = [p for p in choices if sum(map(is_vowel, p)) == 1]
            if single:
                part = tuple(map(base, single[0]))
                notes.append(f'{chunk}: CMU syllable reading {" ".join(part)} (stress not inferred)')
                if len(single) > 1:
                    notes.append(f'{chunk}: alternate syllable readings exist; use --phones to disambiguate')
            else:
                part = spelling_phones(chunk)
                notes.append(f'{chunk}: engine spelling {" ".join(part)} (a=ah, e=eh, i=ih)')
            if len(chunks) > 1 and sum(map(is_vowel, part)) != 1:
                raise ValueError(f'syllable {chunk!r} needs one vowel nucleus; separate vowels with a hyphen or use --phones')
            sounds.extend(part)
            boundaries.append(len(sounds))
        return Pronunciation(validate_phones(sounds), 'supplied syllables' if len(chunks) > 1 else 'supplied engine spelling',
                             tuple(notes), boundaries=tuple(boundaries[:-1]))
    choices = dictionary().get(word.strip().lower(), ())
    if choices:
        return Pronunciation(validate_phones(choices[0]), 'CMU dictionary (US English)',
                             ('Dictionary reading is a suggestion; use --reading or --phones to override.',),
                             tuple(' '.join(p) for p in choices[1:]))
    sounds = spelling_phones(word.strip().lower())
    return Pronunciation(validate_phones(sounds), 'spelling assumption (not in dictionary)',
                         ('No English pronunciation inferred; all letters are sounded. Supply --reading or --phones to confirm.',))
