"""Experimental sound profiles; see docs/sound-dials.md for evidence and limits.

Generation is a weighted draw without replacement from an exact-length grammar.
Every spelling has one decomposition into consonant/vowel runs, so pages cannot
repeat spellings. Mood scores are design preferences, not measured emotions.
"""

import functools
import hashlib
import json
import math
import random
from dataclasses import dataclass


DIALS = {
    'energy': ('restful', 'energetic'),
    'weight': ('light / delicate', 'heavy / substantial'),
    'novelty': ('familiar-sounding', 'unusual / buzzy'),
}
# Recipes are our hypotheses. They are not mood categories fitted by the study.
MOODS = {
    'calm':     {'energy': 1, 'weight': 3, 'novelty': 2, 'ending': 'open'},
    'airy':     {'energy': 3, 'weight': 0, 'novelty': 3, 'ending': 'open'},
    'grounded': {'energy': 2, 'weight': 9, 'novelty': 2, 'ending': 'closed'},
    'bold':     {'energy': 9, 'weight': 9, 'novelty': 4, 'ending': 'closed'},
    'playful':  {'energy': 8, 'weight': 2, 'novelty': 7, 'ending': 'open'},
    'lyrical':  {'energy': 3, 'weight': 4, 'novelty': 4, 'ending': 'open'},
    'strange':  {'energy': 6, 'weight': 5, 'novelty': 10, 'ending': 'either'},
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
# r/w/h/ch and the richer grammar are extrapolations beyond that experiment.
# Clusters use explicit phoneme tuples; sh/ch are individual sounds here.
ONSETS = [(s, (s,)) for s in CLASSES] + [
    (s, tuple(s)) for s in ('bl', 'br', 'dr', 'fl', 'fr', 'gl', 'gr', 'kl',
                           'kr', 'pl', 'pr', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr')]
MIDDLES = [(s, (s,)) for s in CLASSES] + [
    (s, tuple(s)) for s in ('lm', 'ln', 'lv', 'mn', 'nd', 'ng', 'nk', 'nt', 'nv',
                           'rd', 'rk', 'rl', 'rm', 'rn', 'rv', 'ld', 'lk', 'lp',
                           'lt', 'mb', 'mp', 'nz', 'st', 'sk', 'sp', 'ft', 'gm')]
CODAS = [(s, (s,)) for s in ('n', 'm', 'l', 'r', 's', 'z', 'k', 't', 'd')] + [
    (s, tuple(s)) for s in ('nd', 'nt', 'rk', 'rn', 'ld', 'st')]
VOWELS = ('a', 'e', 'i', 'o', 'u', 'ee', 'oo', 'ai')
# Intended approximate readings, not a grapheme-to-phoneme guarantee:
# a=ah, e=eh, i=ih, o=oh, u=oo, ee=ee, oo=oo, ai=ay.
FRONT_VOWELS = frozenset(('e', 'i', 'ee', 'ai'))


def resolve_profile(mood='calm', blend=None, energy=None, weight=None,
                    novelty=None, ending=None):
    if mood not in MOODS:
        raise ValueError(f'unknown mood: {mood}')
    result = dict(MOODS[mood])
    if blend:
        try:
            other, amount = blend.split(':')
            amount = float(amount)
        except (ValueError, AttributeError):
            raise ValueError('--blend must be MOOD:FRACTION, such as playful:0.3') from None
        if other not in MOODS or not math.isfinite(amount) or not 0 <= amount <= 1:
            raise ValueError('--blend needs a known mood and a fraction from 0 to 1')
        for dial in DIALS:
            result[dial] = (1 - amount) * result[dial] + amount * MOODS[other][dial]
    for dial, value in (('energy', energy), ('weight', weight), ('novelty', novelty)):
        if value is not None:
            if not math.isfinite(value) or not 0 <= value <= 10:
                raise ValueError(f'--{dial} must be between 0 and 10')
            result[dial] = value
    if ending is not None:
        if ending not in ('open', 'closed', 'either'):
            raise ValueError('ending must be open, closed, or either')
        result['ending'] = ending
    for dial in DIALS:
        result[dial] = round(float(result[dial]), 8)
    return result


@dataclass(frozen=True)
class Token:
    text: str
    weight: float


class Shape:
    def __init__(self, slots, length, prior):
        self.slots, self.length, self.prior = slots, length, prior
        # Per-instance cache avoids retaining old Shape objects globally.
        self.partition = functools.lru_cache(None)(self._partition)
        self.count, self.mass = self.partition(0, length)

    def _partition(self, depth, left):
        if depth == len(self.slots):
            return (1, 1.0) if left == 0 else (0, 0.0)
        if left < 0:
            return 0, 0.0
        count, mass = 0, 0.0
        for token in self.slots[depth]:
            n, w = self.partition(depth + 1, left - len(token.text))
            count += n
            mass += token.weight * w
        return count, mass


class MoodSpace:
    VERSION = 1

    def __init__(self, mood='calm', length=6, seed=42, blend=None, energy=None,
                 weight=None, novelty=None, syllables=None, ending=None):
        if not 3 <= length <= 14:
            raise ValueError('mood length must be from 3 to 14 characters')
        if syllables is not None and not 1 <= syllables <= 5:
            raise ValueError('--syllables must be from 1 to 5')
        self.profile = resolve_profile(mood, blend, energy, weight, novelty, ending)
        self.length, self.seed = length, seed
        self.mood, self.syllables, self.blend = mood, syllables, blend
        # Normalize relative preferences; these are not emotion probabilities.
        targets = [(self.profile[d] - 5) / 5 for d in DIALS]
        scales = (.60, .49, .40)

        def consonants(items):
            tokens = []
            for text, sounds in items:
                vector = [sum(EFFECTS[CLASSES[s]][i] for s in sounds) / len(sounds)
                          for i in range(3)]
                score = sum(t * v / scale for t, v, scale in zip(targets, vector, scales))
                # The cluster preference is a design heuristic, not a study coefficient.
                cluster = .12 * math.exp(1.2 * targets[2]) if len(sounds) > 1 else 1
                tokens.append(Token(text, math.exp(1.5 * score) * cluster))
            return tuple(tokens)

        onset, middle, coda = map(consonants, (ONSETS, MIDDLES, CODAS))
        vowels = tuple(Token(v, math.exp(.9 * (targets[0] - targets[1]) *
                                        (1 if v in FRONT_VOWELS else -1)) *
                            (.25 if len(v) > 1 else 1)) for v in VOWELS)
        shapes = []
        for size in ([syllables] if syllables else range(1, 6)):
            for starts in (False, True):
                for ends in (False, True):
                    if self.profile['ending'] != 'either' and ends != (self.profile['ending'] == 'closed'):
                        continue
                    slots = ([onset] if starts else []) + [vowels]
                    for _ in range(size - 1):
                        slots += [middle, vowels]
                    if ends:
                        slots += [coda]
                    # Structure preferences are deliberately separate from sound evidence.
                    preferred_size = min(5, max(1, (length - 1) // 2 if ends else (length + 1) // 2))
                    prior = math.exp(-2 * (size - preferred_size) ** 2) * (.85 if starts else .15)
                    shape = Shape(tuple(slots), length, prior)
                    if shape.count:
                        shapes.append(shape)
        self.shapes = shapes
        self.capacity = sum(s.count for s in shapes)
        if not self.capacity:
            raise ValueError('no words fit this length, syllable count, and ending; adjust those constraints')
        grammar = {'classes': CLASSES, 'onsets': ONSETS, 'middles': MIDDLES,
                   'codas': CODAS, 'vowels': VOWELS, 'effects': EFFECTS}
        self.settings = {'engine': 'mood', 'version': self.VERSION, 'length': length,
                         'seed': seed, 'syllables': syllables, 'profile': self.profile,
                         'grammar': hashlib.sha256(json.dumps(grammar, sort_keys=True).encode()).hexdigest()}

    def names(self):
        """Weighted permutation, lazily sampled without replacement; no disk state."""
        rng = random.Random(self.seed)
        removed = {}  # Prefix -> (absolute weight removed, number of leaves removed).

        def available(key, mass, count):
            used_mass, used_count = removed.get(key, (0.0, 0))
            if used_count == count:
                return 0.0
            # Guard floating cancellation near exhaustion; counts remain exact.
            return max(mass - used_mass, mass * 1e-14)

        def choose(options):
            total = sum(weight for _, weight in options)
            threshold = rng.random() * total
            for value, weight in options:
                threshold -= weight
                if threshold < 0:
                    return value
            return options[-1][0]

        for _ in range(self.capacity):
            roots = [(i, available((i,), s.prior, s.count)) for i, s in enumerate(self.shapes)]
            route = choose([(i, w) for i, w in roots if w > 0])
            shape = self.shapes[route]
            key, left, prefix_mass = (route,), self.length, shape.prior / shape.mass
            keys, parts = [key], []
            for depth, slot in enumerate(shape.slots):
                options = []
                for index, token in enumerate(slot):
                    count, mass = shape.partition(depth + 1, left - len(token.text))
                    if count:
                        remaining = available(key + (index,), prefix_mass * token.weight * mass, count)
                        if remaining > 0:
                            options.append((index, remaining))
                index = choose(options)
                token = slot[index]
                key += (index,)
                keys.append(key)
                parts.append(token.text)
                left -= len(token.text)
                prefix_mass *= token.weight
            for prefix in keys:
                mass, count = removed.get(prefix, (0.0, 0))
                removed[prefix] = (mass + prefix_mass, count + 1)
            yield ''.join(parts).capitalize()

    def describe(self):
        values = ' '.join(f'{d}={self.profile[d]:g}' for d in DIALS)
        return (f'mood={self.mood} {values} ending={self.profile["ending"]} '
                f'syllables={self.syllables or "auto"} length={self.length} seed={self.seed}')
