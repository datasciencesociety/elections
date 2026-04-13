#!/usr/bin/env python3
"""
scrape_cik_addresses.py

Scrapes full polling station addresses from CIK results pages.
The CIK results pages have better addresses than the raw data exports —
they include street names, numbers, school names, and neighbourhoods.

Stores results in locations.protocol_address column.

HTML structure:
  div.pr-group
    p.city → settlement
    div.addr-group
      strong → full address
      span → section code (9 digits)

URL pattern: https://results.cik.bg/{election_slug}/rezultati/{mir_number}.html

Usage:
    python3 scrape_cik_addresses.py                    # scrape latest election
    python3 scrape_cik_addresses.py --election pe202410
    python3 scrape_cik_addresses.py --dry-run
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
CACHE_DIR = Path(__file__).parent / "cik_address_cache"

BASE_URL = "https://results.cik.bg"
USER_AGENT = "bg-elections-data/1.0 (civic transparency research)"
RATE_LIMIT_S = 1.0

# CIK results page slug → (area_len, [DB election slugs that share this page])
# area_len=2: national elections (MIR 01-32), area_len=4: local (municipality codes)
# Addresses are the same for all ballots on the same page, so we scrape once per CIK page.
CIK_PAGES: dict[str, tuple[int, list[str]]] = {
    "pe202410":       (2, ["pe202410"]),
    "pe202410_ks":    (2, ["pe202410_ks"]),
    "europe2024":     (2, ["europe2024_ns", "europe2024_ep"]),
    "ns2023":         (2, ["ns2023"]),
    "ns2022":         (2, ["ns2022"]),
    "pvrns2021/tur1": (2, ["pvrns2021_ns", "pvrns2021_pvr_r1"]),
    "pvrns2021/tur2": (2, ["pvrns2021_pvr_r2"]),
    "pi2021_07":      (2, ["pi2021_jul"]),
    "pi2021":         (2, ["pi2021_apr"]),
    "mi2023/tur1":    (4, ["mi2023_council", "mi2023_mayor_r1", "mi2023_kmetstvo_r1", "mi2023_neighbourhood_r1"]),
    "mi2023/tur2":    (4, ["mi2023_mayor_r2", "mi2023_kmetstvo_r2", "mi2023_neighbourhood_r2"]),
}


class CIKAddressParser(HTMLParser):
    """Parse CIK results HTML to extract section_code -> address mappings.
    Also extracts data-el (election ID) for building protocol URLs."""

    def __init__(self):
        super().__init__()
        self.results: list[tuple[str, str, str]] = []  # (section_code, address, data_el)
        self._in_addr_group = False
        self._in_strong = False
        self._in_span = False
        self._span_data_el = ""
        self._current_address = ""
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        classes = attr_dict.get("class", "")
        if tag == "div" and "addr-group" in classes:
            self._in_addr_group = True
            self._current_address = ""
            self._depth = 0
        if self._in_addr_group:
            if tag == "strong":
                self._in_strong = True
            elif tag == "span":
                self._in_span = True
                self._span_data_el = attr_dict.get("data-el", "")
            if tag == "div":
                self._depth += 1

    def handle_endtag(self, tag):
        if self._in_addr_group:
            if tag == "strong":
                self._in_strong = False
            elif tag == "span":
                self._in_span = False
            if tag == "div":
                self._depth -= 1
                if self._depth <= 0:
                    self._in_addr_group = False

    def handle_data(self, data):
        if self._in_strong:
            self._current_address += data
        elif self._in_span and self._in_addr_group:
            code = data.strip()
            if re.match(r"^\d{9}$", code) and self._current_address:
                self.results.append((code, self._current_address.strip(), self._span_data_el))


def _proto_suffix(cik_slug: str, machine_count: int | None) -> str:
    """Protocol URL suffix varies by election era.
    pi2021 (Apr 2021): no suffix — flat HAS_PROTO array, URLs are just {code}.html
    pi2021_07..ns2022: always .0
    ns2023, mi2023/*: always .1
    europe2024+, pe202410+: .0 if machine, .1 if no machine
    """
    if cik_slug == 'pi2021':
        return ''
    if cik_slug in ('pi2021_07', 'ns2022') or cik_slug.startswith('pvrns2021'):
        return '.0'
    if cik_slug in ('ns2023',) or cik_slug.startswith('mi2023'):
        return '.1'
    return '.0' if machine_count and machine_count > 0 else '.1'


def fetch_page(url: str) -> str | None:
    """Fetch a URL. No retries."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8")
    except Exception:
        return None


def get_mir_count(election_slug: str) -> int:
    """Determine how many MIR pages exist for an election."""
    # Most elections have 31 domestic + 32 abroad = 32 total
    # Local elections have different structure
    # Try fetching page 1, then binary search for max
    for n in [32, 35, 31]:
        url = f"{BASE_URL}/{election_slug}/rezultati/{n}.html"
        html = fetch_page(url)
        if html and "addr-group" in html:
            return n
    # Fallback: try up to 35
    return 35


def _area_codes(area_len: int, conn: sqlite3.Connection | None = None) -> list[int]:
    """Return the list of area codes to iterate for a given area_len.
    area_len=2: national MIRs 1-35. area_len=4: municipality oik_codes from DB."""
    if area_len == 2:
        return list(range(1, 36))
    if area_len == 4 and conn:
        rows = conn.execute("SELECT CAST(oik_code AS INTEGER) FROM municipalities ORDER BY oik_code").fetchall()
        return [r[0] for r in rows]
    # fallback: try a wide range
    return list(range(101, 3300))


def scrape_election(election_slug: str, area_len: int = 2,
                    conn: sqlite3.Connection | None = None,
                    dry_run: bool = False) -> dict[str, dict]:
    """Scrape all area pages for an election.
    Returns {section_code: {address, data_el, area}}."""
    CACHE_DIR.mkdir(exist_ok=True)
    # Normalize slug for cache filename (replace / with _)
    cache_name = election_slug.replace("/", "_")
    cache_file = CACHE_DIR / f"{cache_name}.json"

    if cache_file.exists():
        with open(cache_file) as f:
            cached = json.load(f)
        print(f"Loaded {len(cached):,} cached addresses for {election_slug}")
        return cached

    results: dict[str, dict] = {}
    areas = _area_codes(area_len, conn)
    fmt = f"0{area_len}d"

    for area in areas:
        area_str = f"{area:{fmt}}"
        url = f"{BASE_URL}/{election_slug}/rezultati/{area_str}.html"
        html = fetch_page(url)
        if not html or "addr-group" not in html:
            continue

        parser = CIKAddressParser()
        parser.feed(html)

        for code, addr, data_el in parser.results:
            results[code] = {
                "address": addr,
                "data_el": data_el,
                "mir": area,
            }

        print(f"  area {area_str}: {len(parser.results):,} sections", flush=True)
        time.sleep(RATE_LIMIT_S)

    # Cache results
    if results and not dry_run:
        with open(cache_file, "w") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"Total: {len(results):,} section addresses for {election_slug}")
    return results


def apply_addresses(conn: sqlite3.Connection, cik_slug: str, area_len: int,
                    db_slugs: list[str], addresses: dict[str, dict]) -> None:
    """Write scraped addresses to sections + locations for all DB elections sharing this CIK page."""
    area_fmt = f"0{area_len}d"

    for db_slug in db_slugs:
        election = conn.execute(
            "SELECT id FROM elections WHERE slug = ?", (db_slug,)
        ).fetchone()
        if not election:
            print(f"  ⚠ Election '{db_slug}' not found in DB, skipping")
            continue

        election_id = election[0]
        sections_updated = 0
        locations_updated = 0

        for code, info in addresses.items():
            addr = info["address"]

            row = conn.execute("""
                SELECT s.id, s.location_id, s.machine_count FROM sections s
                WHERE s.section_code = ? AND s.election_id = ?
            """, (code, election_id)).fetchone()

            if row:
                section_id, location_id, machine_count = row
                suffix = _proto_suffix(cik_slug, machine_count)
                area_str = f"{info['mir']:{area_fmt}}"
                url = f"{BASE_URL}/{cik_slug}/rezultati/{area_str}.html#/p/{info['data_el']}/{code}{suffix}.html"
                conn.execute(
                    "UPDATE sections SET protocol_address = ?, protocol_url = ? WHERE id = ?",
                    (addr, url, section_id)
                )
                sections_updated += 1

                if location_id:
                    conn.execute(
                        "UPDATE locations SET protocol_address = ? WHERE id = ? AND protocol_address IS NULL",
                        (addr, location_id)
                    )
                    locations_updated += 1

        conn.commit()
        print(f"  {db_slug}: {sections_updated:,} sections, {locations_updated:,} locations updated")


def main():
    parser = argparse.ArgumentParser(description="Scrape CIK polling station addresses")
    parser.add_argument("--election", help="Single CIK page slug (e.g. pe202410, pvrns2021/tur1)")
    parser.add_argument("--all", action="store_true", help="Scrape all elections")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.election and not args.all:
        parser.error("Specify --election SLUG or --all")

    conn = sqlite3.connect(DB_PATH)

    # Ensure columns exist
    for col, col_type in [("protocol_address", "TEXT"), ("protocol_url", "TEXT")]:
        try:
            conn.execute(f"ALTER TABLE sections ADD COLUMN {col} {col_type}")
        except Exception:
            pass
    try:
        conn.execute("ALTER TABLE locations ADD COLUMN protocol_address TEXT")
    except Exception:
        pass

    # Determine which CIK pages to scrape
    if args.all:
        pages = list(CIK_PAGES.items())
    else:
        cik_slug = args.election
        if cik_slug in CIK_PAGES:
            pages = [(cik_slug, CIK_PAGES[cik_slug])]
        else:
            # Unknown slug — assume national (area_len=2), try to find DB election by slug
            pages = [(cik_slug, (2, [cik_slug]))]

    for cik_slug, (area_len, db_slugs) in pages:
        print(f"\n{'='*60}")
        print(f"Scraping {cik_slug} (area_len={area_len}, elections: {', '.join(db_slugs)})")
        print(f"{'='*60}")

        addresses = scrape_election(cik_slug, area_len, conn, args.dry_run)
        if not addresses:
            print("  No addresses found")
            continue

        if args.dry_run:
            for code, info in list(addresses.items())[:10]:
                print(f"  {code} | {info['address'][:60]}")
            continue

        apply_addresses(conn, cik_slug, area_len, db_slugs, addresses)

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
