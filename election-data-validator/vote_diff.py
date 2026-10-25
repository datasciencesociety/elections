"""Vote Difference Comparison — compares per-section vote totals for a party across two election years."""

import argparse
import csv
import io
import os
import re
import sqlite3
import sys

try:
    from .loader import DataLoader, validate_folder, discover_files
except ImportError:
    from loader import DataLoader, validate_folder, discover_files


def extract_year(data_dir: str) -> int:
    """Scan filenames in data_dir for date pattern _DD.MM.YYYY.txt and extract the year.

    Args:
        data_dir: Path to a data folder.

    Returns:
        The 4-digit year as an integer.

    Raises:
        SystemExit: If no date pattern is found in any filename.
    """
    pattern = re.compile(r"_\d{2}\.\d{2}\.(\d{4})\.txt$")
    for entry in os.listdir(data_dir):
        match = pattern.search(entry)
        if match:
            return int(match.group(1))
    sys.exit(f"No date pattern found in filenames in: {data_dir}")


def resolve_party(
    conn_change: sqlite3.Connection,
    conn_base: sqlite3.Connection,
    party_number: int,
) -> tuple[int, int, str]:
    """Look up party name from change year, then find matching party number in base year.

    Args:
        conn_change: SQLite connection for the change (later) year.
        conn_base: SQLite connection for the base (earlier) year.
        party_number: The party number in the change year.

    Returns:
        Tuple of (change_party_number, base_party_number, party_name).

    Raises:
        SystemExit: If party not found in change year or name not matched in base year.
    """
    # Look up party name in change year
    row = conn_change.execute(
        "SELECT party_name FROM cik_parties WHERE party_number = ?",
        (party_number,),
    ).fetchone()
    if row is None:
        sys.exit(f"Party number {party_number} not found in change year data")
    party_name = row[0]

    # Find matching party name in base year
    row = conn_base.execute(
        "SELECT party_number FROM cik_parties WHERE party_name = ?",
        (party_name,),
    ).fetchone()
    if row is None:
        sys.exit(f"Party '{party_name}' has no match in base year data")

    return party_number, row[0], party_name


def compute_differences(
    conn_change: sqlite3.Connection,
    conn_base: sqlite3.Connection,
    change_party_num: int,
    base_party_num: int,
) -> list[tuple[str, int, str]]:
    """Compute per-section vote differences between change and base years.

    Performs a full outer join: sections in both years, only in change year (base=0),
    and only in base year (change=0).

    Args:
        conn_change: SQLite connection for the change year.
        conn_base: SQLite connection for the base year.
        change_party_num: Party number in the change year.
        base_party_num: Party number in the base year.

    Returns:
        Sorted list of (section_code, difference, presence) tuples.
        presence is one of: "both", "base_only", "change_only".
    """
    # Gather votes by section from change year
    change_votes: dict[str, int] = {}
    for row in conn_change.execute(
        "SELECT section_code, total_votes FROM votes WHERE party_number = ?",
        (change_party_num,),
    ):
        change_votes[row[0]] = row[1]

    # Gather votes by section from base year
    base_votes: dict[str, int] = {}
    for row in conn_base.execute(
        "SELECT section_code, total_votes FROM votes WHERE party_number = ?",
        (base_party_num,),
    ):
        base_votes[row[0]] = row[1]

    # Full outer join via union of keys
    all_sections = set(change_votes.keys()) | set(base_votes.keys())
    differences = []
    for section in all_sections:
        in_change = section in change_votes
        in_base = section in base_votes
        cv = change_votes.get(section, 0)
        bv = base_votes.get(section, 0)

        if in_change and in_base:
            presence = "both"
        elif in_change:
            presence = "change_only"
        else:
            presence = "base_only"

        differences.append((section, cv - bv, presence))

    differences.sort(key=lambda x: x[0])
    return differences


def format_difference(diff: int) -> str:
    """Format a vote difference with the appropriate sign prefix.

    Args:
        diff: Integer difference value.

    Returns:
        "+N" for positive, "-N" for negative, "0" for zero.
    """
    if diff > 0:
        return f"+{diff}"
    elif diff < 0:
        return str(diff)
    else:
        return "0"


def main(argv: list[str] | None = None) -> None:
    """CLI entry point: parse args → extract years → load data → resolve party → compute diffs → output."""
    parser = argparse.ArgumentParser(
        description="Compare per-section vote totals for a party across two election years",
    )
    parser.add_argument(
        "data_dir1",
        help="Path to first election data folder",
    )
    parser.add_argument(
        "data_dir2",
        help="Path to second election data folder",
    )
    parser.add_argument(
        "party_number",
        type=int,
        help="Party number (in the later/change year)",
    )
    parser.add_argument(
        "-o", "--output",
        help="Path to output file (default: print to stdout)",
    )
    args = parser.parse_args(argv)

    # Validate both folders and check required files
    validate_folder(args.data_dir1)
    validate_folder(args.data_dir2)
    discover_files(args.data_dir1)
    discover_files(args.data_dir2)

    # Extract years and determine base vs change
    year1 = extract_year(args.data_dir1)
    year2 = extract_year(args.data_dir2)

    if year1 == year2:
        sys.exit(f"Both folders contain data from the same year ({year1}). Two different years are required.")

    if year1 < year2:
        base_dir, change_dir = args.data_dir1, args.data_dir2
    else:
        base_dir, change_dir = args.data_dir2, args.data_dir1

    # Load each folder into a separate in-memory SQLite database
    loader_base = DataLoader(db_path=":memory:", data_dir=base_dir)
    loader_base.load_all()
    conn_base = loader_base.conn

    loader_change = DataLoader(db_path=":memory:", data_dir=change_dir)
    loader_change.load_all()
    conn_change = loader_change.conn

    # Resolve party across years
    change_party_num, base_party_num, party_name = resolve_party(
        conn_change, conn_base, args.party_number,
    )

    # Compute differences
    differences = compute_differences(conn_change, conn_base, change_party_num, base_party_num)

    # Map presence labels to folder names
    base_name = os.path.basename(os.path.normpath(base_dir))
    change_name = os.path.basename(os.path.normpath(change_dir))
    presence_labels = {
        "both": "both",
        "base_only": base_name,
        "change_only": change_name,
    }

    # Build CSV output
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["section_code", "difference", "presence"])
    for section_code, diff, presence in differences:
        writer.writerow([section_code, format_difference(diff), presence_labels[presence]])
    output_text = buf.getvalue()

    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="") as f:
            f.write(output_text)
        print(f"Results written to {args.output}")
    else:
        print(output_text, end="")


if __name__ == "__main__":
    main()
