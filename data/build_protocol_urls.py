#!/usr/bin/env python3
"""
build_protocol_urls.py

Populates sections.protocol_url for all elections based on CIK URL patterns.
Mirrors the shape used by `web/src/lib/cik-links.ts`. Keep them in sync.

CIK's page is a hash router:
    {prefix}/rezultati/{area}.html#/{type}/{data_el}/{section}{suffix}.html

Per-election knobs:
  • prefix      — URL path under https://results.cik.bg
  • area_len    — leading digits of section_code for `{area}.html`.
                  National elections use 2 (oblast / RIK); mi2023 local
                  elections use 4 (oblast + municipality).
  • proto_type  — "p" for most protocols, "pk" for the 2024 const-court ballot.
  • data_el     — CIK ballot id. 64 = parliament/president, 256 = president
                  round, 1/2/4/8 = council/mayor/kmetstvo/neighbourhood.
  • suffix_rule — how to pick the trailing `.0` / `.1` / `.2` / `""`:
                  "none"  → no suffix (pi2021 array-format HAS_PROTO)
                  "0"     → always ".0" (ns2022, pvrns2021, pi2021_07 — suffix 0 always present)
                  "1"     → always ".1" (mi2023/tur1 — all paper, no machine voting)
                  "auto"  → ".0" if section has machines (ХМ combined), else ".1" (Х paper-only)
                  "auto2" → ".2" if section has machines (ХМ combined), else ".1" (Х paper-only)
                            Used for ns2023 where suffix 0 does not exist in HAS_PROTO.

Safe to re-run: overwrites existing protocol_url values.

Usage:
    python3 data/build_protocol_urls.py
    python3 data/build_protocol_urls.py --dry-run
"""

import argparse
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))


@dataclass(frozen=True)
class CikConfig:
    prefix: str
    proto_type: str          # "p" or "pk"
    data_el: int
    suffix_rule: str         # "none" | "0" | "1" | "auto" | "auto2"
    area_len: int            # leading digits of section_code used in `/rezultati/{area}.html`


ELECTION_CONFIG: dict[str, CikConfig] = {
    # pe202410: HAS_PROTO dataEl=64, suffix 0=ХМ (machine+paper), 1=Х (paper-only).
    "pe202410":                 CikConfig("pe202410",            "p",  64,  "auto",  2),
    # pe202410_ks: same suffix scheme; type pk for special court ballot.
    "pe202410_ks":              CikConfig("pe202410_ks",         "pk", 64,  "auto",  2),
    # europe2024: single site for both elections. dataEl 64 = NS parliament, 128 = EP.
    # Verified: /europe2024/protokoli/data.js — no separate /ns/ or /ep/ subfolders exist.
    "europe2024_ns":            CikConfig("europe2024",          "p",  64,  "auto",  2),
    "europe2024_ep":            CikConfig("europe2024",          "p",  128, "auto",  2),
    # mi2023/tur1: HAS_PROTO dataEls 1,2,4,8. All sections have only suffix 1
    # (paper-only — machine voting did not occur in round 1).
    "mi2023_council":           CikConfig("mi2023/tur1",         "p",  1,   "1",     4),
    "mi2023_mayor_r1":          CikConfig("mi2023/tur1",         "p",  2,   "1",     4),
    "mi2023_kmetstvo_r1":       CikConfig("mi2023/tur1",         "p",  4,   "1",     4),
    "mi2023_neighbourhood_r1":  CikConfig("mi2023/tur1",         "p",  8,   "1",     4),
    # mi2023/tur2: HAS_PROTO dataEls 2,4,8. Suffix 0=machine-only, 1=paper-only,
    # 0+2=machine+paper combined. Use "auto" (.0 for machine sections).
    "mi2023_mayor_r2":          CikConfig("mi2023/tur2",         "p",  2,   "auto",  4),
    "mi2023_kmetstvo_r2":       CikConfig("mi2023/tur2",         "p",  4,   "auto",  4),
    "mi2023_neighbourhood_r2":  CikConfig("mi2023/tur2",         "p",  8,   "auto",  4),
    # ns2023: HAS_PROTO dataEl=64. Suffix 1=Х (paper-only), 2=ХМ (machine+paper).
    # Suffix 0 does NOT exist — use "auto2" (machine→.2, paper→.1).
    "ns2023":                   CikConfig("ns2023",              "p",  64,  "auto2", 2),
    # ns2022: HAS_PROTO dataEl=64. Multiple suffixes per section (0+1, 0+1+2, 0+1+2+3).
    # Suffix 0 is always present → always ".0" picks the combined protocol.
    "ns2022":                   CikConfig("ns2022",              "p",  64,  "0",     2),
    # pvrns2021/tur1: dataEls 64 (parliament) + 256 (president). Same multi-suffix, 0 always present.
    "pvrns2021_ns":             CikConfig("pvrns2021/tur1",      "p",  64,  "0",     2),
    "pvrns2021_pvr_r1":         CikConfig("pvrns2021/tur1",      "p",  256, "0",     2),
    # pvrns2021/tur2: dataEl=256 only.
    "pvrns2021_pvr_r2":         CikConfig("pvrns2021/tur2",      "p",  256, "0",     2),
    # pi2021_07: dataEl=64. Multiple suffixes, 0 always present.
    "pi2021_jul":               CikConfig("pi2021_07",           "p",  64,  "0",     2),
    # pi2021: dataEl=64 uses old array format (no suffix objects). No suffix in link.
    "pi2021_apr":               CikConfig("pi2021",              "p",  64,  "none",  2),
}

BASE_URL = "https://results.cik.bg"


def get_suffix(rule: str, machine_count: int) -> str:
    if rule == "none":
        return ""
    if rule == "0":
        return ".0"
    if rule == "1":
        return ".1"
    has_machine = bool(machine_count and machine_count > 0)
    if rule == "auto":
        # suffix 0 = machine+paper combined (ХМ), suffix 1 = paper-only (Х)
        return ".0" if has_machine else ".1"
    if rule == "auto2":
        # suffix 2 = machine+paper combined (ХМ), suffix 1 = paper-only (Х)
        # used for ns2023 where suffix 0 does not exist in HAS_PROTO
        return ".2" if has_machine else ".1"
    raise ValueError(f"Unknown suffix rule: {rule!r}")


def build_url(cfg: CikConfig, section_code: str, machine_count: int) -> str:
    area = section_code[: cfg.area_len]
    suffix = get_suffix(cfg.suffix_rule, machine_count)
    return (
        f"{BASE_URL}/{cfg.prefix}/rezultati/{area}.html"
        f"#/{cfg.proto_type}/{cfg.data_el}/{section_code}{suffix}.html"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)

    # Ensure column exists
    try:
        conn.execute("ALTER TABLE sections ADD COLUMN protocol_url TEXT")
    except Exception:
        pass

    elections = conn.execute("SELECT id, slug, name FROM elections ORDER BY id").fetchall()

    total_updated = 0

    for eid, slug, name in elections:
        cfg = ELECTION_CONFIG.get(slug)
        if not cfg:
            print(f"  SKIP {eid:3d} {slug:30s} — no CIK config")
            continue

        sections = conn.execute("""
            SELECT id, section_code, machine_count
            FROM sections
            WHERE election_id = ?
        """, (eid,)).fetchall()

        updated = 0
        for sid, code, machine_count in sections:
            url = build_url(cfg, code, machine_count or 0)
            if not args.dry_run:
                conn.execute("UPDATE sections SET protocol_url = ? WHERE id = ?", (url, sid))
            updated += 1

        total_updated += updated
        if sections:
            sample_code, sample_mc = sections[0][1], sections[0][2] or 0
            print(f"  {eid:3d} {slug:30s} {updated:6,} sections  {build_url(cfg, sample_code, sample_mc)}")
        else:
            print(f"  {eid:3d} {slug:30s} {updated:6,} sections")

    if not args.dry_run:
        conn.commit()

    conn.close()
    print(f"\nTotal: {total_updated:,} sections updated")


if __name__ == "__main__":
    main()
