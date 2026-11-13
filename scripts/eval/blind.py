"""Blind judging sheets for generated names.

make:   blind.py make OUT LABEL=BATCH_PREFIX [LABEL=BATCH_PREFIX ...] [--n=30]
        Shuffles the per-mood files written by batch.sh into OUT.sheet.txt (names
        only) and OUT.key.json (name -> intended mood and batch label).
score:  blind.py score OUT
        Reads OUT.judged.json ([{"name", "mood", "quality"}, ...]) and prints, per
        batch, how often the judged mood matched the intended one, mean quality
        and the confusion table.
append: blind.py append OUT ROUND data/teacher-judgments.tsv
        Appends the judged sheet to the teacher data used by build-prior.ts.

Always include one earlier batch as an anchor: judges differ in harshness, so
only numbers from the same sheet are comparable.
"""
import sys, json, random, collections
MOODS = ["calm", "airy", "grounded", "bold", "playful", "lyrical", "strange"]
cmd, prefix, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
if cmd == "make":
    n, items = 30, []
    for a in rest:
        if a.startswith("--n="):
            n = int(a[4:])
            continue
        label, batch = a.split("=")
        for mood in MOODS:
            names = [x.strip().capitalize() for x in open(f"{batch}-{mood}.txt") if x.strip()][:n]
            items += [{"name": x, "mood": mood, "system": label} for x in names]
    random.Random(prefix).shuffle(items)
    seen, unique = set(), []
    for item in items:
        if item["name"] not in seen:
            seen.add(item["name"])
            unique.append(item)
    json.dump(unique, open(prefix + ".key.json", "w"))
    open(prefix + ".sheet.txt", "w").write("\n".join(i["name"] for i in unique) + "\n")
    print(len(unique), "names ->", prefix + ".sheet.txt")
else:
    key = {i["name"]: i for i in json.load(open(prefix + ".key.json"))}
    judged = [j for j in json.load(open(prefix + ".judged.json")) if j.get("name") in key]
    if cmd == "append":
        round_id, target = rest
        with open(target, "a") as out:
            for j in judged:
                k = key[j["name"]]
                out.write("\t".join([j["name"].lower(), k["mood"], k["system"], j["mood"], str(j["quality"]), round_id]) + "\n")
        print("appended", len(judged), "judgments as round", round_id)
        sys.exit()
    stats = collections.defaultdict(lambda: collections.defaultdict(list))
    confusion = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for j in judged:
        k = key[j["name"]]
        s = stats[k["system"]]
        hit = j["mood"] == k["mood"]
        s[k["mood"] + ":hit"].append(hit)
        s["all:hit"].append(hit)
        s[k["mood"] + ":q"].append(j["quality"])
        s["all:q"].append(j["quality"])
        confusion[k["system"]][k["mood"]][j["mood"]] += 1
    mean = lambda xs: sum(xs) / max(1, len(xs))
    for system, s in stats.items():
        print(f"\n[{system}] mood read as intended {mean(s['all:hit']):.2f}  quality {mean(s['all:q']):.2f}  graded 4-5 {mean([q >= 4 for q in s['all:q']]):.2f}  n={len(s['all:q'])}")
        for mood in MOODS:
            row = " ".join(f"{t[:4]}:{confusion[system][mood][t]:2d}" for t in MOODS)
            print(f"  {mood:9s} {mean(s[mood + ':hit']):.2f} q {mean(s[mood + ':q']):.2f} | {row}")
