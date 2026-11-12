"""Build the self-hosted UI font subsets (development only, never a runtime step).

Usage: python -I scripts/fonts.py SOURCE_DIR
SOURCE_DIR holds the OFL sources from github.com/google/fonts:
  FunnelDisplay.ttf (ofl/funneldisplay/FunnelDisplay[wght].ttf)
  Inter.ttf (ofl/inter/Inter[opsz,wght].ttf)
Requires fonttools and brotli. Writes WOFF2 files to src/fonts/.

Licences are in public/fonts-LICENSE.txt.
"""

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "src" / "fonts"
# ASCII plus the punctuation and arrows the interface renders.
UNICODES = [*range(0x20, 0x7F), 0xA0, 0xB7, 0xD7, 0x2013, 0x2014, 0x2018,
            0x2019, 0x201C, 0x201D, 0x2026, 0x2190, 0x2191, 0x2192, 0x2193,
            0x2197, 0x2212]


def rename(font: TTFont, family: str, style: str) -> None:
    names = {1: family, 2: style, 3: f"{family} {style}; subset",
             4: f"{family} {style}", 6: f"{family.replace(' ', '')}-{style}",
             16: family, 17: style}
    table = font["name"]
    table.names = [n for n in table.names if n.nameID not in names]
    for name_id, value in names.items():
        table.setName(value, name_id, 3, 1, 0x409)


def build(src: str, out: str, axes: dict | None, features: list[str],
          family: str | None = None, style: str = "Regular") -> None:
    font = TTFont(SRC / src)
    if axes:
        font = instancer.instantiateVariableFont(font, axes)
    if family:
        rename(font, family, style)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = features
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    font.flavor = "woff2"  # the subset API does not apply options.flavor on save
    OUT.mkdir(parents=True, exist_ok=True)
    font.save(OUT / out)
    print(out, (OUT / out).stat().st_size, "bytes")


build("FunnelDisplay.ttf", "funnel-display-500.woff2", {"wght": 500},
      ["kern"], family="Funnel Display", style="Medium")
# Inter sets only short UI text, so its 9 KB kerning table is omitted.
build("Inter.ttf", "inter-400.woff2", {"opsz": 14, "wght": 400}, ["tnum"],
      family="Inter", style="Regular")
build("Inter.ttf", "inter-600.woff2", {"opsz": 14, "wght": 600}, ["tnum"],
      family="Inter", style="SemiBold")
