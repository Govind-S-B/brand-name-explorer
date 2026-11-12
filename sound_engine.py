"""Shared sound evidence and weighting; independent of word-shape restrictions.

The generator uses these weights forward. Its inverter uses that exact forward
distribution, and refuses to fit references outside the generator's support.
"""

import math

DIALS = {
    'energy': ('restful', 'energetic'),
    'weight': ('light / delicate', 'heavy / substantial'),
    'novelty': ('familiar-sounding', 'unusual / buzzy'),
}
# Reported consonant-category differences from the overall factor mean:
# Sidhu, Vigliocco & Pexman (2022), pp. 33–34 of the accepted manuscript.
# 0 denotes no directional preference in this implementation, not proof of no effect.
EFFECTS = {
    'sonorant': (-.60, -.49, -.26),
    'voiced_fricative': (.39, .28, .40),
    'voiceless_fricative': (0, -.26, 0),
    'voiceless_stop': (.36, .23, 0),
    'voiced_stop': (0, .24, -.17),
}
CLASSES = {
    **dict.fromkeys(('l', 'm', 'n', 'r', 'w'), 'sonorant'),
    **dict.fromkeys(('v', 'z'), 'voiced_fricative'),
    **dict.fromkeys(('f', 's', 'sh', 'h'), 'voiceless_fricative'),
    **dict.fromkeys(('p', 't', 'k', 'ch'), 'voiceless_stop'),
    **dict.fromkeys(('b', 'd', 'g'), 'voiced_stop'),
}

SCALES = (.60, .49, .40)


def targets(profile):
    return [(profile[d] - 5) / 5 for d in DIALS]


def consonant_weight(sounds, target):
    vector = [sum(EFFECTS[CLASSES[s]][i] for s in sounds) / len(sounds)
              for i in range(3)]
    score = sum(t * v / scale for t, v, scale in zip(target, vector, SCALES))
    cluster = .12 * math.exp(1.2 * target[2]) if len(sounds) > 1 else 1
    return math.exp(1.5 * score) * cluster


def vowel_weight(front, target, spelling_length=1):
    return (math.exp(.9 * (target[0] - target[1]) * (1 if front else -1)) *
            (.25 if spelling_length > 1 else 1))


# Explicit bridge from the current generator's intended sounds to ARPABET.
# Missing sounds stay missing; e.g. schwa is not silently treated as 'a'.
CONSONANT_PHONES = {s: s.upper() for s in CLASSES}
CONSONANT_PHONES['h'] = 'HH'
VOWEL_PHONES = {'a': 'AA', 'e': 'EH', 'i': 'IH', 'o': 'OW',
                'u': 'UW', 'ee': 'IY', 'oo': 'UW', 'ai': 'EY'}
