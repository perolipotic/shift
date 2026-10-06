# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.66.1", "brotli==1.2.0"]
# ///
"""Derive Shift Figures, DM Sans's digits on one fixed advance (story 7.2).

DM Sans ships no tabular figures: there is no `tnum` in its GSUB, and its
digits are proportional (`1` is 312 units, `0` is 684). So `tabular-nums`
does nothing and columns of numbers wobble. This script builds a digits-only
face from the Fontsource DM Sans file the app already bundles:

  1. instance the `wght` axis at each weight the app uses (400-800),
  2. subset to `.notdef` and U+0030-0039, with no GSUB, GPOS or GDEF,
  3. give every digit ONE advance W, the widest digit advance across ALL
     five weights, and shift its outline right by (W - advance) / 2, so it
     sits centred. One W for every weight, because a column can mix weights
     (a past date `font-normal` above a future one `font-semibold`, a bold
     total under regular rows) and must still align,
  4. rename the family to `Shift Figures`, keeping the OFL notice,
  5. write `apps/web/src/assets/fonts/shift-figures-<weight>.woff2`.

The output is byte-deterministic: `head.modified` is pinned to the source's
own value and timestamps are never recalculated. Run it from anywhere:

    uv run scripts/fonts/build-figures.py

and `git status` stays clean when the checked-in files are current.
"""

from __future__ import annotations

import hashlib
import io
import sys
from pathlib import Path
from typing import NoReturn

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

REPO = Path(__file__).resolve().parents[2]
SOURCE = (
    REPO
    / "apps/web/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2"
)
# The Fontsource file the checked-in figures were derived from. A Fontsource
# bump changes it; the script then refuses to run until this is updated, and
# `test/typography-coverage.test.ts` fails until the files are regenerated.
SOURCE_SHA256 = "9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543"
OUT_DIR = REPO / "apps/web/src/assets/fonts"
WEIGHTS = (400, 500, 600, 700, 800)
DIGITS = list(range(0x30, 0x3A))
FAMILY = "Shift Figures"
OFL = (
    "This Font Software is licensed under the SIL Open Font License, Version 1.1. "
    "This license is available with a FAQ at: https://openfontlicense.org"
)


def fail(message: str) -> NoReturn:
    sys.exit(f"build-figures: {message}")


def load_source() -> TTFont:
    if not SOURCE.is_file():
        fail(f"DM Sans source not found: {SOURCE}\n(run `pnpm install` first)")
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        fail(
            f"DM Sans source changed (sha256 {digest}, expected {SOURCE_SHA256}): {SOURCE}\n"
            "Fontsource was bumped. Check the new file, set SOURCE_SHA256 to its digest, "
            "and regenerate the figures."
        )
    font = TTFont(SOURCE, recalcTimestamp=False)
    axes = {axis.axisTag: axis for axis in font["fvar"].axes} if "fvar" in font else {}
    wght = axes.get("wght")
    if wght is None or wght.minValue > min(WEIGHTS) or wght.maxValue < max(WEIGHTS):
        fail(f"source has no wght axis covering {min(WEIGHTS)}-{max(WEIGHTS)}: {SOURCE}")
    cmap = font.getBestCmap()
    missing = [f"U+{code:04X}" for code in DIGITS if code not in cmap]
    if missing:
        fail(f"source cmap lacks digits {', '.join(missing)}: {SOURCE}")
    return font


def subset_to_digits(font: TTFont) -> None:
    options = Options()
    options.layout_features = []
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "STAT"]
    options.hinting = False
    options.notdef_glyph = True
    options.notdef_outline = True
    options.glyph_names = False
    options.name_IDs = []  # rebuilt below
    options.recalc_timestamp = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=DIGITS)
    subsetter.subset(font)


def digit_names(font: TTFont) -> list[str]:
    cmap = font.getBestCmap()
    return [cmap[code] for code in DIGITS]


def widest_digit(font: TTFont) -> int:
    hmtx = font["hmtx"]
    return max(hmtx[name][0] for name in digit_names(font))


def centre_digits(font: TTFont, widest: int) -> None:
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    names = digit_names(font)
    for name in names:
        advance, lsb = hmtx[name]
        shift = round((widest - advance) / 2)
        glyph = glyf[name]
        if glyph.isComposite():
            for component in glyph.components:
                component.x += shift
        elif glyph.numberOfContours > 0:
            glyph.coordinates.translate((shift, 0))
        glyph.recalcBounds(glyf)
        hmtx[name] = (widest, getattr(glyph, "xMin", lsb + shift))
    advances = {hmtx[name][0] for name in names}
    if advances != {widest}:
        fail(f"digits do not share one advance {widest}: {sorted(advances)}")


def source_names(font: TTFont) -> dict[int, str]:
    """Read before subsetting, which drops every name record."""
    return {record.nameID: record.toUnicode() for record in font["name"].names if record.platformID == 3}


def rename(font: TTFont, weight: int, source: dict[int, str]) -> None:
    name = font["name"]
    missing = [name_id for name_id in (0, 5) if name_id not in source]
    if missing:
        fail(f"source lacks name record(s) {missing} (copyright, version): {SOURCE}")
    copyright_notice = source[0]
    version = source[5]
    postscript = f"ShiftFigures-W{weight}"
    name.names = []
    for name_id, value in (
        (0, copyright_notice),
        (1, FAMILY),
        (2, "Regular"),
        (3, f"{version.removeprefix('Version ')};{postscript};derived from DM Sans"),
        (4, f"{FAMILY} W{weight}"),
        (5, version),
        (6, postscript),
        (13, OFL),
        (14, "https://openfontlicense.org"),
    ):
        name.setName(value, name_id, 3, 1, 0x409)
    font["OS/2"].usWeightClass = weight


def instance(weight: int) -> TTFont:
    font = instantiateVariableFont(load_source(), {"wght": weight})
    font.recalcTimestamp = False
    return font


def build(font: TTFont, weight: int, widest: int) -> bytes:
    names = source_names(font)
    subset_to_digits(font)
    centre_digits(font, widest)
    rename(font, weight, names)
    font.flavor = "woff2"
    buffer = io.BytesIO()
    font.save(buffer, reorderTables=True)
    return buffer.getvalue()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    instances = {weight: instance(weight) for weight in WEIGHTS}
    widest = max(widest_digit(font) for font in instances.values())
    print(f"one digit advance for every weight: {widest} units")
    for weight, font in instances.items():
        target = OUT_DIR / f"shift-figures-{weight}.woff2"
        data = build(font, weight, widest)
        target.write_bytes(data)
        print(f"{target.relative_to(REPO)}  {len(data)} bytes")


if __name__ == "__main__":
    main()
