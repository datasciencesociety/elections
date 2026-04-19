#!/usr/bin/env python3
"""Slim the CIK polling-place index into a per-address static JSON.

Input:  ../.internal/external-coords/cik-map-pe202604.json
        { count, rows: [{ rik, section_codes[], address, lat, lon, confirmed }] }

Output: public/data/sections-pe202604.json
        [{ id, rik, address, lat, lon, section_codes[] }]

One row per physical polling location. Dropping to address-level cuts the
marker count by ~40% (7,401 addresses vs 11,903 sections) so MapLibre isn't
stacking 10 icons on one pixel — a school with 10 rooms is one pin, not
ten. `id` is the first section_code so the UI has a stable React key.
Section-level detail lives in `section_codes[]` and is used when the user
clicks into a card.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
SRC = REPO_ROOT / ".internal" / "external-coords" / "cik-map-pe202604.json"
DST = HERE.parent / "public" / "data" / "sections-pe202604.json"


def main() -> None:
    with SRC.open() as f:
        data = json.load(f)

    out: list[dict] = []
    skipped_abroad = 0
    total_sections = 0
    for row in data["rows"]:
        # RIK 32 is the abroad district. There are no CIK cameras there,
        # so the /live map has nothing to render for those sections.
        if row["rik"] == 32:
            skipped_abroad += len(row["section_codes"])
            continue
        codes = sorted(row["section_codes"])
        total_sections += len(codes)
        out.append(
            {
                "id": codes[0],
                "rik": row["rik"],
                "address": row["address"],
                "lat": row["lat"],
                "lon": row["lon"],
                "section_codes": codes,
            }
        )

    DST.parent.mkdir(parents=True, exist_ok=True)
    with DST.open("w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"{SRC} -> {DST}")
    print(
        f"{len(out)} addresses, {total_sections} sections "
        f"({skipped_abroad} abroad skipped)"
    )


if __name__ == "__main__":
    main()
