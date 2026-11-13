#!/bin/zsh
# Domain-filtered batch per mood, through the real CLI pipeline.
# usage: scripts/eval/batch.sh OUT_PREFIX [count] [extra cli args...]
#   e.g. scripts/eval/batch.sh /tmp/bne-eval/run1 30 --length 6
#   MOODS="swift crisp" limits the moods; the default is every mood.
# Writes OUT_PREFIX-<mood>.txt (one available name per line) and prints how many
# candidates each mood consumed. Lookups reuse OUT_PREFIX.sqlite as their cache.
prefix=$1; count=${2:-30}; shift; [ $# -gt 0 ] && shift
mkdir -p "$(dirname "$prefix")"
moods=(${=MOODS:-$(npx tsx cli/main.ts --list-moods 2>/dev/null | tail -n +2 | cut -f1)})
for mood in $moods; do
  npx tsx cli/main.ts --mood $mood --count $count --cache "${CACHE:-$prefix.sqlite}" "$@" 2>"$prefix-$mood.err" \
    | cut -f1 | sed 's/\.com//' > "$prefix-$mood.txt"
  echo "== $mood: $(wc -l < "$prefix-$mood.txt" | tr -d ' ') available, $(grep -o '"cursor":[0-9]*' "$prefix-$mood.err" | tail -1) $(grep -o '"seconds":[0-9.]*' "$prefix-$mood.err" | tail -1)"
  tr '\n' ' ' < "$prefix-$mood.txt"; echo
done
