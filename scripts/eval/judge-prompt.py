"""Print the blind-judge prompt for a sheet, listing every current mood.
usage: python3 scripts/eval/judge-prompt.py OUT_PREFIX   (reads core/constants.json)"""
import json, sys, random
prefix = sys.argv[1]
feel = json.load(open("core/constants.json"))["feel"]
moods = list(feel.items())
random.Random(prefix).shuffle(moods)
lines = "\n".join(f"   - {m}: {f}" for m, f in moods)
print(f"""You are acting as an experienced brand-naming consultant doing a blind evaluation of invented brand names. Use only Read and Write tools; no web access, no running generators, no looking at any other files.

Read the file {prefix}.sheet.txt. It has one invented name per line. They came from several different generators and were shuffled; you are not told which is which.

For EVERY name, judge two things purely from how the name sounds and looks:

1. "mood": which ONE of these {len(moods)} feelings the name most conveys:
{lines}
2. "quality": 1-5 integer for how good it is as a real brand name, ignoring mood. 1 = awkward/unpronounceable/embarrassing or ugly on the page; 2 = clumsy, clearly machine-made; 3 = usable but forgettable; 4 = good, could plausibly be a real company or product; 5 = excellent, an agency could present it. Be a tough, honest grader and use the full range; say the name aloud in your head, and penalise ambiguous pronunciation, unfortunate resemblances, ugly letter combinations.

Judge each name independently on first impression; don't try to balance the mood counts. Keep your standard constant from the first name to the last. Use the mood keys exactly as written above.

Write the result to {prefix}.judged.json as a JSON array with one object per name, in the same order as the sheet, exactly of the form {{"name": "Xxxxx", "mood": "calm", "quality": 3}}. Every name from the sheet must appear exactly once with the same spelling. The final file must be one complete valid JSON array with no placeholders or truncation; re-read the end of it to confirm.

Your final reply: the count of entries written; then for each of the {len(moods)} feelings, one short sentence on which sound or spelling cues made you choose it and which feelings you found hard to tell apart; then recurring flaws with example names; then the 15 names you would shortlist as the strongest.""")
