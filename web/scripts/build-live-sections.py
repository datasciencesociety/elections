#!/usr/bin/env python3
"""Flatten the CIK polling-place index into a per-section static JSON.

Input:  ../.internal/external-coords/cik-map-pe202604.json
        { count, rows: [{ rik, section_codes[], address, lat, lon, confirmed }] }

Output: public/data/sections-pe202604.json
        [{ section_code, rik, address, lat, lon }]

Each polling address hosts 1..N sections — one row per section code so the
frontend can key the map layer by `section_code` and match the live metrics
endpoint one-to-one.
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
    for row in data["rows"]:
        for code in row["section_codes"]:
            out.append(
                {
                    "section_code": code,
                    "rik": row["rik"],
                    "address": row["address"],
                    "lat": row["lat"],
                    "lon": row["lon"],
                }
            )

    DST.parent.mkdir(parents=True, exist_ok=True)
    with DST.open("w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"{SRC} -> {DST}")
    print(f"{len(data['rows'])} addresses, {len(out)} sections")


if __name__ == "__main__":
    main()
