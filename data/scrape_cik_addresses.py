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


def _proto_suffix(election_slug: str, machine_count: int | None) -> str:
    """Protocol URL suffix varies by election era.
    pi2021_apr (Apr 2021): no suffix — flat HAS_PROTO array, URLs are just {code}.html
    pi2021_jul..ns2022: always .0
    ns2023, mi2023_*: always .1
    europe2024+, pe202410+: .0 if machine, .1 if no machine
    """
    if election_slug == 'pi2021':
        return ''
    if election_slug in ('pi2021_07', 'pvrns2021', 'ns2022'):
        return '.0'
    if election_slug in ('ns2023',) or election_slug.startswith('mi2023'):
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


def scrape_election(election_slug: str, dry_run: bool = False) -> dict[str, dict]:
    """Scrape all MIR pages for an election.
    Returns {section_code: {address, data_el, mir}}."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{election_slug}.json"

    if cache_file.exists():
        with open(cache_file) as f:
            cached = json.load(f)
        print(f"Loaded {len(cached):,} cached addresses for {election_slug}")
        return cached

    results: dict[str, dict] = {}
    mir_max = 35  # try all, skip 404s

    for mir in range(1, mir_max + 1):
        url = f"{BASE_URL}/{election_slug}/rezultati/{mir:02d}.html"
        html = fetch_page(url)
        if not html or "addr-group" not in html:
            continue

        parser = CIKAddressParser()
        parser.feed(html)

        for code, addr, data_el in parser.results:
            results[code] = {
                "address": addr,
                "data_el": data_el,
                "mir": mir,
            }

        print(f"  MIR {mir:>2}: {len(parser.results):,} sections", flush=True)
        time.sleep(RATE_LIMIT_S)

    # Cache results
    if results and not dry_run:
        with open(cache_file, "w") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"Total: {len(results):,} section addresses for {election_slug}")
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--election", default="pe202410", help="Election slug")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    # Scrape
    addresses = scrape_election(args.election, args.dry_run)
    if not addresses:
        print("No addresses found")
        return

    if args.dry_run:
        for code, info in list(addresses.items())[:20]:
            print(f"  {code} | {info['address'][:60]}")
            print(f"    {BASE_URL}/{args.election}/rezultati/{info['mir']:02d}.html#/p/{info['data_el']}/{code}.<0|1>.html")
        return

    # Update DB
    conn = sqlite3.connect(DB_PATH)

    # Ensure columns exist
    for col, col_type in [("protocol_address", "TEXT"), ("protocol_url", "TEXT")]:
        try:
            conn.execute(f"ALTER TABLE sections ADD COLUMN {col} {col_type}")
        except Exception:
            pass

    # Also add protocol_address to locations (shared across elections)
    try:
        conn.execute("ALTER TABLE locations ADD COLUMN protocol_address TEXT")
    except Exception:
        pass

    # Match section_code -> update sections and locations
    election = conn.execute(
        "SELECT id FROM elections WHERE slug = ?", (args.election,)
    ).fetchone()
    if not election:
        print(f"Election '{args.election}' not found in DB")
        conn.close()
        return

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
            suffix = _proto_suffix(args.election, machine_count)
            url = f"{BASE_URL}/{args.election}/rezultati/{info['mir']:02d}.html#/p/{info['data_el']}/{code}{suffix}.html"
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

    print(f"Updated {sections_updated:,} sections with protocol address + URL")
    print(f"Updated {locations_updated:,} locations with protocol address")

    conn.close()


if __name__ == "__main__":
    main()
