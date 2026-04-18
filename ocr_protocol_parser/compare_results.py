"""Compare generated output files against CIK ground truth.

Usage:
    python compare_results.py --output-dir ./output --ground-truth-dir ../election-results-2024 --section 010100001
    python compare_results.py --output-dir ./output --ground-truth-dir ../election-results-2024
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


# Common OCR digit confusions: pairs of characters often swapped by OCR
_OCR_CONFUSIONS = {
    ("0", "6"), ("0", "8"), ("0", "9"), ("1", "7"), ("1", "4"),
    ("3", "8"), ("5", "6"), ("5", "8"), ("6", "8"), ("6", "0"),
    ("8", "0"), ("8", "3"), ("8", "6"), ("9", "0"),
}


def _ocr_comment(got: str, expected: str) -> str:
    """Estimate OCR error probability based on digit similarity."""
    if got in ("?", "MISSING") or expected in ("?", "EXTRA"):
        return "missing_data"

    try:
        g, e = int(got), int(expected)
    except (ValueError, TypeError):
        return "non_numeric"

    if g == 0 and e == 0:
        return ""
    if g == 0 and e != 0:
        return "likely_ocr: value missed (read as 0/empty)"
    if g != 0 and e == 0:
        return "likely_ocr: phantom value (should be 0)"

    # Check digit-level confusion
    gs, es = str(g), str(e)
    if len(gs) == len(es):
        confused = sum(
            1 for a, b in zip(gs, es)
            if a != b and ((a, b) in _OCR_CONFUSIONS or (b, a) in _OCR_CONFUSIONS)
        )
        diff_digits = sum(1 for a, b in zip(gs, es) if a != b)
        if diff_digits == 1 and confused == 1:
            return "high_prob_ocr: single digit confusion"
        if diff_digits == 1:
            return "likely_ocr: single digit differs"
        if confused > 0:
            return f"likely_ocr: {confused}/{diff_digits} confused digits"

    # Magnitude check
    if e != 0:
        ratio = abs(g - e) / max(abs(e), 1)
        if ratio < 0.3:
            return "possible_ocr: small difference"
        if ratio > 5:
            return "unknown: large difference"

    return "unknown_cause"


def _index_prefs(lines: list[str]) -> dict[tuple[str, str], tuple[str, str, str]]:
    """Index preference lines by (party, candidate)."""
    result = {}
    for line in lines:
        p = line.strip().split(";")
        if len(p) >= 7:
            result[(p[2], p[3])] = (p[4], p[5], p[6])
    return result


def _parse_protocol_line(line: str) -> dict[str, str]:
    """Parse a protocol line into a dict with field names."""
    parts = line.strip().split(";")
    keys = [
        "form_number", "section_code", "rik_code", "page_numbers",
        "field5", "field6", "ballots_received", "voter_list_count",
        "additional_voters", "voted_count", "unused_ballots",
        "invalid_ballots", "paper_ballots", "invalid_votes",
        "no_support_paper", "valid_votes_paper",
        "machine_ballots", "no_support_machine", "valid_votes_machine",
    ]
    return {keys[i]: parts[i] if i < len(parts) else "" for i in range(len(keys))}


def _parse_vote_line(line: str) -> tuple[str, str, str, list[tuple[str, str, str, str]]]:
    """Parse a vote line into header + party groups."""
    parts = line.strip().split(";")
    header = (parts[0], parts[1], parts[2])
    parties = []
    for i in range(3, len(parts), 4):
        if i + 3 < len(parts):
            parties.append((parts[i], parts[i+1], parts[i+2], parts[i+3]))
    return header[0], header[1], header[2], parties


def _load_lines_by_section(path: Path) -> dict[str, str]:
    """Load a CIK file and index lines by section_code (field 2)."""
    result = {}
    if not path.exists():
        return result
    for line in path.read_text(encoding="utf-8").strip().splitlines():
        parts = line.split(";")
        if len(parts) >= 2:
            result[parts[1]] = line
    return result


def _load_pref_lines_by_section(path: Path) -> dict[str, list[str]]:
    """Load preferences file and group lines by section_code (field 2)."""
    result: dict[str, list[str]] = {}
    if not path.exists():
        return result
    for line in path.read_text(encoding="utf-8").strip().splitlines():
        parts = line.split(";")
        if len(parts) >= 2:
            result.setdefault(parts[1], []).append(line)
    return result


def compare_protocols(output_line: str, truth_line: str, section: str) -> list[str]:
    """Compare two protocol lines field by field. Returns list of differences."""
    out = _parse_protocol_line(output_line)
    truth = _parse_protocol_line(truth_line)
    diffs = []
    for key in out:
        if key in ("field5", "field6", "page_numbers"):
            continue
        o, t = out[key], truth[key]
        if o != t:
            diffs.append(f"  {key}: got={o} expected={t}")
    return diffs


def compare_votes(output_line: str, truth_line: str, section: str) -> list[str]:
    """Compare two vote lines. Returns list of differences."""
    o_parts = output_line.strip().split(";")
    t_parts = truth_line.strip().split(";")
    diffs = []

    # Header
    for i, name in enumerate(["form_number", "section_code", "rik_code"]):
        if i < len(o_parts) and i < len(t_parts) and o_parts[i] != t_parts[i]:
            diffs.append(f"  {name}: got={o_parts[i]} expected={t_parts[i]}")

    # Party groups
    o_parties = {}
    for i in range(3, len(o_parts), 4):
        if i + 3 < len(o_parts):
            o_parties[o_parts[i]] = (o_parts[i+1], o_parts[i+2], o_parts[i+3])

    t_parties = {}
    for i in range(3, len(t_parts), 4):
        if i + 3 < len(t_parts):
            t_parties[t_parts[i]] = (t_parts[i+1], t_parts[i+2], t_parts[i+3])

    all_party_nums = sorted(set(o_parties) | set(t_parties), key=lambda x: int(x))
    for pn in all_party_nums:
        o = o_parties.get(pn, ("?", "?", "?"))
        t = t_parties.get(pn, ("?", "?", "?"))
        if o != t:
            parts = []
            if o[0] != t[0]:
                parts.append(f"total: got {o[0]} expected {t[0]}")
            if o[1] != t[1]:
                parts.append(f"paper: got {o[1]} expected {t[1]}")
            if o[2] != t[2]:
                parts.append(f"machine: got {o[2]} expected {t[2]}")
            diffs.append(f"  party {pn}: {', '.join(parts)}")

    return diffs


def compare_preferences(output_lines: list[str], truth_lines: list[str], section: str) -> list[str]:
    """Compare preference lines. Returns list of differences."""
    diffs = []

    # Index by (party, candidate)
    def index_prefs(lines: list[str]) -> dict[tuple[str, str], tuple[str, str, str]]:
        result = {}
        for line in lines:
            p = line.strip().split(";")
            if len(p) >= 7:
                key = (p[2], p[3])  # party, candidate
                result[key] = (p[4], p[5], p[6])  # total, paper, machine
            elif len(p) >= 5:
                key = (p[2], p[3])
                result[key] = (p[4], p[5] if len(p) > 5 else "0", p[6] if len(p) > 6 else "0")
        return result

    o_prefs = index_prefs(output_lines)
    t_prefs = index_prefs(truth_lines)

    # Only report differences for keys in ground truth
    for key in sorted(t_prefs, key=lambda k: (int(k[0]) if k[0].isdigit() else 999, k[1])):
        t = t_prefs[key]
        o = o_prefs.get(key)
        if o is None:
            parts = []
            if t[0] != "0":
                parts.append(f"total: expected {t[0]}")
            if t[1] != "0":
                parts.append(f"paper: expected {t[1]}")
            if t[2] != "0":
                parts.append(f"machine: expected {t[2]}")
            label = f"  party {key[0]} cand {key[1]}: MISSING"
            if parts:
                label += f" ({', '.join(parts)})"
            diffs.append(label)
        elif o != t:
            parts = []
            if o[0] != t[0]:
                parts.append(f"total: got {o[0]} expected {t[0]}")
            if o[1] != t[1]:
                parts.append(f"paper: got {o[1]} expected {t[1]}")
            if o[2] != t[2]:
                parts.append(f"machine: got {o[2]} expected {t[2]}")
            diffs.append(f"  party {key[0]} cand {key[1]}: {', '.join(parts)}")

    # Extra keys in output not in ground truth
    for key in sorted(o_prefs):
        if key not in t_prefs:
            o = o_prefs[key]
            if o != ("0", "0", "0"):  # only report non-zero extras
                diffs.append(f"  party {key[0]} cand {key[1]}: EXTRA ({o[0]},{o[1]},{o[2]})")

    return diffs


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare OCR parser output against CIK ground truth.")
    parser.add_argument("--output-dir", required=True, help="Directory with generated output files.")
    parser.add_argument("--ground-truth-dir", required=True, help="Directory with CIK ground truth files.")
    parser.add_argument("--section", default=None, help="Compare only this section code.")
    parser.add_argument("--gt-suffix", default="_27.10.2024", help="Suffix for ground truth filenames (default: _27.10.2024).")
    parser.add_argument("--diff-csv", default=None, help="Path to write diff CSV file.")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    gt_dir = Path(args.ground_truth_dir)
    suffix = args.gt_suffix

    # Load files
    out_protocols = _load_lines_by_section(out_dir / "protocols.txt")
    gt_protocols = _load_lines_by_section(gt_dir / f"protocols{suffix}.txt")
    out_votes = _load_lines_by_section(out_dir / "votes.txt")
    gt_votes = _load_lines_by_section(gt_dir / f"votes{suffix}.txt")
    out_prefs = _load_pref_lines_by_section(out_dir / "preferences.txt")
    gt_prefs = _load_pref_lines_by_section(gt_dir / f"preferences{suffix}.txt")

    sections = sorted(set(out_protocols) & set(gt_protocols))
    if args.section:
        sections = [s for s in sections if s == args.section]

    if not sections:
        print("No matching sections found.")
        return

    csv_rows: list[dict[str, str]] = []
    total_diffs = 0
    sections_ok = 0

    for section in sections:
        section_diffs: list[str] = []

        # Protocols
        if section in out_protocols and section in gt_protocols:
            out = _parse_protocol_line(out_protocols[section])
            truth = _parse_protocol_line(gt_protocols[section])
            diffs = compare_protocols(out_protocols[section], gt_protocols[section], section)
            if diffs:
                section_diffs.append("PROTOCOLS:")
                section_diffs.extend(diffs)
            for key in out:
                if key in ("field5", "field6", "page_numbers"):
                    continue
                o, t = out[key], truth[key]
                if o != t:
                    csv_rows.append({
                        "section": section, "type": "protocol", "field": key,
                        "party": "", "candidate": "",
                        "got": o, "expected": t,
                        "comment": _ocr_comment(o, t),
                    })

        # Votes
        if section in out_votes and section in gt_votes:
            diffs = compare_votes(out_votes[section], gt_votes[section], section)
            if diffs:
                section_diffs.append("VOTES:")
                section_diffs.extend(diffs)
            o_parts = out_votes[section].strip().split(";")
            t_parts = gt_votes[section].strip().split(";")
            o_parties = {}
            for vi in range(3, len(o_parts), 4):
                if vi + 3 < len(o_parts):
                    o_parties[o_parts[vi]] = (o_parts[vi+1], o_parts[vi+2], o_parts[vi+3])
            t_parties = {}
            for vi in range(3, len(t_parts), 4):
                if vi + 3 < len(t_parts):
                    t_parties[t_parts[vi]] = (t_parts[vi+1], t_parts[vi+2], t_parts[vi+3])
            for pn in sorted(set(o_parties) | set(t_parties), key=lambda x: int(x)):
                o = o_parties.get(pn, ("?", "?", "?"))
                t = t_parties.get(pn, ("?", "?", "?"))
                if o != t:
                    got_str = f"total={o[0]} paper={o[1]} machine={o[2]}"
                    exp_str = f"total={t[0]} paper={t[1]} machine={t[2]}"
                    csv_rows.append({
                        "section": section, "type": "votes", "field": "party_votes",
                        "party": pn, "candidate": "",
                        "got": got_str, "expected": exp_str,
                        "comment": _ocr_comment(o[1], t[1]),
                    })

        # Preferences
        if section in out_prefs and section in gt_prefs:
            diffs = compare_preferences(out_prefs[section], gt_prefs[section], section)
            if diffs:
                section_diffs.append(f"PREFERENCES ({len(diffs)} differences):")
                section_diffs.extend(diffs[:20])
                if len(diffs) > 20:
                    section_diffs.append(f"  ... and {len(diffs) - 20} more")
            o_idx = _index_prefs(out_prefs[section])
            t_idx = _index_prefs(gt_prefs[section])
            for key in sorted(set(o_idx) | set(t_idx), key=lambda k: (int(k[0]) if k[0].isdigit() else 999, k[1])):
                o = o_idx.get(key)
                t = t_idx.get(key)
                if o == t:
                    continue
                if o is None:
                    csv_rows.append({
                        "section": section, "type": "preferences", "field": "candidate",
                        "party": key[0], "candidate": key[1],
                        "got": "MISSING",
                        "expected": f"total={t[0]} paper={t[1]} machine={t[2]}",
                        "comment": "missing_data",
                    })
                elif t is None:
                    if o != ("0", "0", "0"):
                        csv_rows.append({
                            "section": section, "type": "preferences", "field": "candidate",
                            "party": key[0], "candidate": key[1],
                            "got": f"total={o[0]} paper={o[1]} machine={o[2]}",
                            "expected": "EXTRA",
                            "comment": "extra_data",
                        })
                else:
                    got_str = f"total={o[0]} paper={o[1]} machine={o[2]}"
                    exp_str = f"total={t[0]} paper={t[1]} machine={t[2]}"
                    csv_rows.append({
                        "section": section, "type": "preferences", "field": "candidate",
                        "party": key[0], "candidate": key[1],
                        "got": got_str, "expected": exp_str,
                        "comment": _ocr_comment(o[0], t[0]),
                    })

        if section_diffs:
            print(f"\n=== Section {section} ===")
            for line in section_diffs:
                print(line)
            total_diffs += sum(1 for d in section_diffs if d.startswith("  "))
        else:
            sections_ok += 1
            print(f"Section {section}: OK")

    print(f"\n--- Summary: {len(sections)} sections compared, {sections_ok} OK, {total_diffs} differences ---")

    # Write CSV
    if args.diff_csv and csv_rows:
        import csv
        csv_path = Path(args.diff_csv)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "section", "type", "field", "party", "candidate",
                "got", "expected", "comment",
            ])
            writer.writeheader()
            writer.writerows(csv_rows)
        print(f"Diff CSV written to {csv_path} ({len(csv_rows)} rows)")


if __name__ == "__main__":
    main()
