"""Opt-in nearby words from the forward grammar; never an inverse fallback."""

import heapq

from inverter import parse_spelling, spelling_phone_sequence
from pronunciation import base, is_vowel
from sound_engine import CONSONANT_PHONES, VOWEL_PHONES
from sound_profiles import CODAS, MIDDLES, ONSETS, MoodSpace


# Similarity is an explicit search heuristic, not an emotional-distance model.
MANNER = {p: group for group, sounds in enumerate((
    'B D G K P T', 'DH F S SH TH V Z ZH', 'CH JH', 'M N NG', 'L R', 'W Y', 'HH'))
    for p in sounds.split()}
TOKEN_PHONES = {text: tuple(CONSONANT_PHONES[s] for s in sounds)
                for text, sounds in ONSETS + MIDDLES + CODAS}
TOKEN_PHONES.update({text: (phone,) for text, phone in VOWEL_PHONES.items()})
BEAM_WIDTH = 48


def replacement_cost(a, b):
    """Integer half-units: same=0, related=1, otherwise=2."""
    if a == b:
        return 0
    if is_vowel(a) and is_vowel(b):
        return 1
    if a in MANNER and b in MANNER and MANNER[a] == MANNER[b]:
        return 1
    return 2


def advance(row, target, phone):
    next_row = [row[0] + 2]
    for i, original in enumerate(target, 1):
        next_row.append(min(next_row[-1] + 2, row[i] + 2,
                            row[i-1] + replacement_cost(original, phone)))
    return tuple(next_row)


def spelling_distance(a, b):
    row = list(range(len(a) + 1))
    for char in b:
        next_row = [row[0] + 1]
        for i, original in enumerate(a, 1):
            next_row.append(min(next_row[-1] + 1, row[i] + 1, row[i-1] + (original != char)))
        row = next_row
    return row[-1]


def edit_description(source, target):
    """Trace one minimum-cost alignment in deterministic order."""
    rows = [tuple(2*i for i in range(len(source)+1))]
    for phone in target:
        rows.append(advance(rows[-1], source, phone))
    i, j, changes = len(source), len(target), []
    while i or j:
        if i and j and rows[j][i] == rows[j-1][i-1] + replacement_cost(source[i-1], target[j-1]):
            if source[i-1] != target[j-1]:
                changes.append(f'sound {i}: {source[i-1]} → {target[j-1]}')
            i, j = i-1, j-1
        elif i and rows[j][i] == rows[j][i-1] + 2:
            changes.append(f'remove sound {i}: {source[i-1]}')
            i -= 1
        else:
            changes.append(f'insert {target[j-1]} after original sound {i}')
            j -= 1
    return list(reversed(changes))


def suggest(pronunciation, reference, count):
    if not isinstance(count, int) or not 1 <= count <= 20:
        raise ValueError('--substitutions must be from 1 to 20')
    source = tuple(map(base, pronunciation.phones))
    reference = reference.strip().lower()
    center = min(14, max(3, len(reference)))
    sizes = range(max(3, center-2), min(14, center+2)+1)
    syllables = min(5, max(1, pronunciation.structure['syllables']))
    syllable_range = range(max(1, syllables-1), min(5, syllables+1)+1)
    candidates = {}
    for length in sizes:
        for size in syllable_range:
            try:
                space = MoodSpace(length=length, syllables=size, opening='any', ending='either',
                                  energy=5, weight=5, novelty=5)
            except ValueError:
                continue
            for shape in space.shapes:
                beam = [('', tuple(2*i for i in range(len(source)+1)), length)]
                for depth, slot in enumerate(shape.slots):
                    expanded = []
                    for prefix, row, left in beam:
                        for token in slot:
                            rest = left - len(token.text)
                            if not shape.partition(depth+1, rest)[0]:
                                continue
                            updated = row
                            for phone in TOKEN_PHONES[token.text]:
                                updated = advance(updated, source, phone)
                            expanded.append((prefix+token.text, updated, rest))
                    # Min(row) lower-bounds edit distance to a completion. Beam
                    # pruning is bounded and approximate, not a global optimum.
                    final = depth == len(shape.slots)-1
                    beam = heapq.nsmallest(BEAM_WIDTH, expanded,
                                          key=lambda item: (item[1][-1] if final else min(item[1]),
                                                            item[1][-1], item[0]))
                for word, row, _ in beam:
                    if word != reference:
                        candidates[word] = row[-1]
    ordered = sorted(candidates, key=lambda word: (
        candidates[word], spelling_distance(reference, word), abs(len(word)-len(reference)), word))
    results, seen_phones = [], set()
    for word in ordered:
        parsed = parse_spelling(word)
        phones = spelling_phone_sequence(parsed)
        if phones in seen_phones:
            continue
        seen_phones.add(phones)
        original_structure = dict(length=len(reference), **pronunciation.structure)
        structure_changes = [f'{key}: {value} → {parsed["structure"][key]}'
                             for key, value in original_structure.items()
                             if value != parsed['structure'][key]]
        results.append(dict(word=word.capitalize(), phones=list(phones),
                            sound_edit_cost=candidates[word]/2,
                            edits=edit_description(source, phones),
                            structure_changes=structure_changes,
                            structure=parsed['structure']))
        if len(results) == count:
            break
    relaxed = []
    if any(p[-1].isdigit() for p in pronunciation.phones):
        relaxed.append('Stress is omitted; the generator cannot preserve it.')
    if pronunciation.boundaries:
        relaxed.append('Explicit syllable boundary positions are omitted.')
    return dict(method='bounded phoneme-edit beam search; not guaranteed globally nearest',
                searched_lengths=list(sizes), searched_syllables=list(syllable_range),
                beam_width=BEAM_WIDTH, relaxed=relaxed, results=results)
