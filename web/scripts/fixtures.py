"""Produce parity fixtures and compact assets from the unchanged Python reference."""
import hashlib
import itertools
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from sound_profiles import MoodSpace, MOODS, ONSETS, MIDDLES, CODAS, VOWELS, FRONT_VOWELS
from sound_engine import CLASSES, EFFECTS, CONSONANT_PHONES, VOWEL_PHONES
from pronunciation import dictionary, read_reference
from reverse_finder import report
from inverter import parse_spelling, fit_profiles
from substitutions import suggest
from name_generator import LegacySpace, PRESETS

root=Path(__file__).resolve().parents[1]
(root/'src/data').mkdir(exist_ok=True)
constants=dict(moods=MOODS,onsets=ONSETS,middles=MIDDLES,codas=CODAS,vowels=VOWELS,
               front_vowels=sorted(FRONT_VOWELS),classes=CLASSES,effects=EFFECTS,
               consonant_phones=CONSONANT_PHONES,vowel_phones=VOWEL_PHONES,presets=PRESETS)
(root/'src/core/constants.json').write_text(json.dumps(constants,separators=(',',':'))+'\n')
dictionary_data=dictionary()
phones=sorted(set(p for readings in dictionary_data.values() for reading in readings for p in reading))
alphabet=''.join(chr(i) for i in range(33,127) if chr(i) not in '|\\"')
assert len(phones)<=len(alphabet)
encode={p:alphabet[i] for i,p in enumerate(phones)}
lines=[word+'\t'+'|'.join(''.join(encode[p] for p in reading) for reading in readings) for word,readings in dictionary_data.items()]
compact=dict(phones=phones,alphabet=alphabet[:len(phones)],entries='\n'.join(lines))
(root/'src/data/cmudict.json').write_text(json.dumps(compact,separators=(',',':'))+'\n')
(root/'public/cmudict-LICENSE.txt').write_bytes((root.parent/'data/cmudict/LICENSE').read_bytes())

generators=[]
options=[dict(mood=m,seed=s) for m in MOODS for s in [42,0,-7,12345678901234567890]]
options += [dict(length=n,seed=99,ending=e) for n in [3,4,7,10,14] for e in ['open','closed','either']]
options += [dict(mood='strange',length=7,opening=o,syllables=s,seed=123) for o in ['any','vowel','consonant','cluster'] for s in [1,2,3]]
options += [dict(mood='grounded',blend='playful:0.3',energy=8.123456789,weight=2,novelty=7,length=7),dict(mood='calm',opening='cluster',length=4),dict(length=3,syllables=1,opening='consonant')]
for settings in options:
    try:
        space=MoodSpace(**settings)
        generators.append(dict(settings={**settings,'seed':str(settings.get('seed',42))},capacity=space.capacity,profile=space.profile,names=list(itertools.islice(space.names(),500 if settings==dict(mood='calm',seed=42) else 60))))
    except ValueError as error:
        generators.append(dict(settings=settings,error=str(error)))
legacy=[]
for style in PRESETS:
    for length in [None,3 if style!='calm' else 2,13 if style!='calm' else 14]:
        for seed in [42,-7,12345678901234567890]:
            space=LegacySpace(style,seed,length)
            legacy.append(dict(settings=dict(style=style,seed=str(seed),length=length),capacity=space.capacity,names=list(itertools.islice(space.names(),100))))
references=[dict(word='lemoru',reading='lemoru'),dict(word='figma'),dict(word='rudolf'),dict(word='himmel'),dict(word='fern'),dict(word='testarossa'),dict(word='valve'),dict(word='zafkiel',reading='zaf-ki-el'),dict(word='shien',reading='she-en'),dict(word='giorno',reading='jee-orn-o'),dict(word='lemoru',phones='L EH1 M OW0 R UW0'),dict(word='abc',reading='lem'),dict(word='chairo',reading='chairo')]
reports=[dict(input=case,result=report(**case)) for case in references]
substitutions=[dict(input=case,result=suggest(read_reference(**case),case['word'],3)) for case in references[:10]]
fits=[]
for word in ['lemoru','figma','shashi','brana','oom','chairo']:
    parsed=parse_spelling(word)
    fits.append(dict(word=word,parsed=parsed,top=fit_profiles(parsed)[:10]))
fixture=dict(generators=generators,legacy=legacy,reports=reports,substitutions=substitutions,fits=fits,random={})
import random
for seed in [0,42,-7,12345678901234567890]:
    r=random.Random(seed)
    fixture['random'][str(seed)]=dict(random=[r.random() for _ in range(20)])
    r=random.Random(seed)
    fixture['random'][str(seed)]['randbelow']=[r.randrange(1000000007) for _ in range(20)]
(root/'tests/parity.json').write_text(json.dumps(fixture,indent=2)+'\n')
print(json.dumps(dict(generators=len(generators),legacy=len(legacy),reports=len(reports),substitutions=len(substitutions),fits=len(fits),dictionary_words=len(dictionary_data),dictionary_bytes=(root/'src/data/cmudict.json').stat().st_size)))
