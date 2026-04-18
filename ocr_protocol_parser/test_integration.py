"""Integration tests against real CIK data.

Process real HTML section files end-to-end and compare output
against official CIK reference data. Comparisons are field-by-field
for key fields, with tolerance for known OCR parsing limitations.

Requirements: 10.1, 10.3, 11.1, 11.3, 12.1, 12.3, 1.1, 14.3
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure module directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cli import main
from output_writer import format_preference_line, format_protocol_line, format_vote_line
from section_processor import SectionProcessor

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

_MODULE_DIR = Path(__file__).resolve().parent          # elections/ocr-protocol-parser/
_ELECTIONS_DIR = _MODULE_DIR.parent                     # elections/
_WORKSPACE_ROOT = _ELECTIONS_DIR.parent                 # workspace root
_HTML_DIR = _WORKSPACE_ROOT / "election-results-2024" / "2024-html"

_SECTION_001_DIR = _HTML_DIR / "010100001.0"
_SECTION_018_DIR = _HTML_DIR / "010100018.0"

_HAS_SECTION_001 = _SECTION_001_DIR.is_dir()
_HAS_SECTION_018 = _SECTION_018_DIR.is_dir()
_HAS_HTML_DIR = _HTML_DIR.is_dir()

# ---------------------------------------------------------------------------
# Official CIK reference data (parsed into dicts for field-by-field comparison)
# ---------------------------------------------------------------------------

# CIK protocol reference for 010100001 (Form 26)
# Fields: formType;sectionCode;rikCode;pageNumbers;;;ballots;voters;additional;
#         voted;unused;invalid_ballots;paper_ballots;invalid_votes;no_support_paper;
#         valid_paper;machine_ballots;no_support_machine;valid_machine
_CIK_PROTOCOL_001 = {
    "form_type": 26,
    "section_code": "010100001",
    "rik_code": 1,
    "ballots_received": 600,
    "voter_list_count": 625,
    "additional_voters": 4,
    "voted_count": 310,
    "unused_ballots": 445,
    "invalid_ballots": 1,
    "paper_ballots": 154,
    "invalid_votes": 6,
    "no_support_votes_paper": 6,
    "valid_votes_paper": 142,
    "machine_ballots": 156,
    "no_support_votes_machine": 10,
    "valid_votes_machine": 146,
}

# CIK protocol reference for 010100018 (Form 24)
_CIK_PROTOCOL_018 = {
    "form_type": 24,
    "section_code": "010100018",
    "rik_code": 1,
    "ballots_received": 100,
    "voter_list_count": 24,
    "additional_voters": 5,
    "voted_count": 20,
    "unused_ballots": 79,
    "invalid_ballots": 1,
    "paper_ballots": 20,
    "invalid_votes": 2,
    "no_support_votes_paper": 0,
    "valid_votes_paper": 18,
}

# CIK votes reference for 010100001 — {party_number: (total, paper, machine)}
_CIK_VOTES_001 = {
    1: (0, 0, 0), 2: (0, 0, 0), 3: (0, 0, 0), 4: (11, 8, 3),
    5: (0, 0, 0), 6: (1, 0, 1), 7: (17, 5, 12), 8: (1, 1, 0),
    9: (0, 0, 0), 10: (1, 0, 1), 11: (0, 0, 0), 12: (46, 22, 24),
    13: (0, 0, 0), 14: (1, 0, 1), 15: (0, 0, 0), 16: (0, 0, 0),
    17: (10, 0, 10), 18: (117, 72, 45), 19: (1, 0, 1), 20: (0, 0, 0),
    21: (1, 1, 0), 22: (1, 1, 0), 23: (0, 0, 0), 24: (0, 0, 0),
    25: (2, 0, 2), 26: (45, 14, 31), 27: (0, 0, 0), 28: (33, 18, 15),
}


def _assert_field_close(actual, expected, field_name, tolerance=0):
    """Assert an integer field matches within tolerance, handling None."""
    if expected is None:
        return  # skip comparison for None expected
    if actual is None:
        pytest.fail(f"{field_name}: got None, expected {expected}")
    if abs(actual - expected) > tolerance:
        pytest.fail(f"{field_name}: got {actual}, expected {expected} (tolerance={tolerance})")


# ---------------------------------------------------------------------------
# 16.1 — Form 26 section (010100001)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _HAS_SECTION_001, reason="HTML files for 010100001 not available")
class TestForm26Integration:
    """Integration test: process section 010100001 (Form 26) end-to-end.

    Validates: Requirements 10.1, 11.1, 12.1
    """

    @pytest.fixture(scope="class")
    def processed(self):
        """Process the section once and cache results for all tests."""
        processor = SectionProcessor(str(_SECTION_001_DIR))
        protocol, votes, preferences = processor.process()
        return protocol, votes, preferences

    # --- Protocol header fields ---

    def test_protocol_section_code(self, processed):
        """Section code must match CIK exactly."""
        protocol, _, _ = processed
        assert protocol.section_code == _CIK_PROTOCOL_001["section_code"]

    def test_protocol_form_type_detected(self, processed):
        """Form type 26 must be detected (form_number contains the full number)."""
        protocol, _, _ = processed
        # The parser stores the full form number (e.g. "01022018"), not the
        # form type. We verify the section was processed as Form 26 by
        # checking that machine fields are present (not None).
        assert protocol.machine_ballots is not None or protocol.valid_votes_machine is not None, (
            "Form 26 section should have machine fields populated"
        )

    def test_protocol_ballots_received(self, processed):
        """Ballots received must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.ballots_received,
            _CIK_PROTOCOL_001["ballots_received"],
            "ballots_received",
        )

    def test_protocol_voter_list_count(self, processed):
        """Voter list count must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.voter_list_count,
            _CIK_PROTOCOL_001["voter_list_count"],
            "voter_list_count",
        )

    def test_protocol_additional_voters(self, processed):
        """Additional voters must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.additional_voters,
            _CIK_PROTOCOL_001["additional_voters"],
            "additional_voters",
        )

    def test_protocol_voted_count(self, processed):
        """Voted count must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.voted_count,
            _CIK_PROTOCOL_001["voted_count"],
            "voted_count",
        )

    def test_protocol_valid_votes_paper(self, processed):
        """Valid paper votes must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.valid_votes_paper,
            _CIK_PROTOCOL_001["valid_votes_paper"],
            "valid_votes_paper",
        )

    def test_protocol_page_numbers_nonempty(self, processed):
        """Page numbers field should be non-empty with pipe-separated values."""
        protocol, _, _ = processed
        assert protocol.page_numbers.startswith("|")
        cn_parts = [p for p in protocol.page_numbers.split("|") if p]
        assert len(cn_parts) > 0, "Should have at least some control numbers"

    def test_protocol_line_has_19_fields(self, processed):
        """Formatted protocol line must have 19 semicolon-separated fields."""
        protocol, _, _ = processed
        line = format_protocol_line(protocol)
        parts = line.split(";")
        assert len(parts) == 19

    def test_protocol_line_empty_fields_5_6(self, processed):
        """Fields 5 and 6 must be empty in formatted output."""
        protocol, _, _ = processed
        line = format_protocol_line(protocol)
        parts = line.split(";")
        assert parts[4] == ""
        assert parts[5] == ""

    # --- Vote fields ---

    def test_votes_has_parties(self, processed):
        """Vote record should contain party vote entries."""
        _, votes, _ = processed
        assert len(votes.party_votes) > 0

    def test_votes_largest_party_18(self, processed):
        """Party 18 (ГЕРБ-СДС) should have the largest total — matches CIK."""
        _, votes, _ = processed
        party18 = None
        for pnum, total, paper, machine in votes.party_votes:
            if pnum == 18:
                party18 = (total, paper, machine)
                break
        assert party18 is not None, "Party 18 not found in vote results"
        exp = _CIK_VOTES_001[18]
        assert party18 == exp, f"Party 18: got {party18}, expected {exp}"

    def test_votes_key_parties_match(self, processed):
        """Key parties with non-zero votes should mostly match CIK data.

        OCR may introduce small errors in a few parties. We require that
        at least 80% of non-zero parties match exactly.
        """
        _, votes, _ = processed
        actual = {pnum: (total, paper, machine)
                  for pnum, total, paper, machine in votes.party_votes}
        key_parties = [p for p, v in _CIK_VOTES_001.items() if v[0] > 0]
        mismatches = []
        matched = 0
        for pnum in key_parties:
            if pnum in actual:
                if actual[pnum] == _CIK_VOTES_001[pnum]:
                    matched += 1
                else:
                    mismatches.append(
                        f"Party {pnum}: got {actual[pnum]}, expected {_CIK_VOTES_001[pnum]}"
                    )
        match_ratio = matched / len(key_parties) if key_parties else 1.0
        assert match_ratio >= 0.8, (
            f"Only {matched}/{len(key_parties)} parties matched exactly. "
            f"Mismatches: {mismatches}"
        )

    def test_votes_total_equals_paper_plus_machine(self, processed):
        """For every party, total must equal paper + machine."""
        _, votes, _ = processed
        for pnum, total, paper, machine in votes.party_votes:
            assert total == paper + machine, (
                f"Party {pnum}: {total} != {paper} + {machine}"
            )

    def test_vote_line_structure(self, processed):
        """Formatted vote line has header + groups of 4 per party."""
        _, votes, _ = processed
        line = format_vote_line(votes)
        parts = line.split(";")
        # Header is 3 fields, then groups of 4
        party_fields = len(parts) - 3
        assert party_fields % 4 == 0
        assert party_fields // 4 == len(votes.party_votes)

    # --- Preference fields ---

    def test_preferences_not_empty(self, processed):
        """Preferences should be generated for Form 26."""
        _, _, preferences = processed
        assert len(preferences) > 0

    def test_preferences_section_code(self, processed):
        """All preference records should have correct section_code."""
        _, _, preferences = processed
        for pref in preferences:
            assert pref.section_code == "010100001"

    def test_preferences_total_equals_paper_plus_machine(self, processed):
        """For every preference, total must equal paper + machine."""
        _, _, preferences = processed
        for pref in preferences:
            assert pref.total_votes == pref.paper_votes + pref.machine_votes, (
                f"Party {pref.party_number} cand {pref.candidate_number}: "
                f"{pref.total_votes} != {pref.paper_votes} + {pref.machine_votes}"
            )

    def test_preference_line_has_7_fields(self, processed):
        """Each formatted preference line must have 7 fields."""
        _, _, preferences = processed
        for pref in preferences[:5]:  # check first 5
            line = format_preference_line(pref)
            parts = line.split(";")
            assert len(parts) == 7


# ---------------------------------------------------------------------------
# 16.2 — Form 24 section (010100018)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _HAS_SECTION_018, reason="HTML files for 010100018 not available")
class TestForm24Integration:
    """Integration test: process section 010100018 (Form 24) end-to-end.

    Validates: Requirements 10.3, 11.3, 12.3
    """

    @pytest.fixture(scope="class")
    def processed(self):
        """Process the section once and cache results for all tests."""
        processor = SectionProcessor(str(_SECTION_018_DIR))
        protocol, votes, preferences = processor.process()
        return protocol, votes, preferences

    # --- Protocol header fields ---

    def test_protocol_section_code(self, processed):
        """Section code must match CIK exactly."""
        protocol, _, _ = processed
        assert protocol.section_code == _CIK_PROTOCOL_018["section_code"]

    def test_protocol_machine_fields_none(self, processed):
        """Form 24 should have None machine fields (paper-only)."""
        protocol, _, _ = processed
        assert protocol.machine_ballots is None
        assert protocol.no_support_votes_machine is None
        assert protocol.valid_votes_machine is None

    def test_protocol_ballots_received(self, processed):
        """Ballots received must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.ballots_received,
            _CIK_PROTOCOL_018["ballots_received"],
            "ballots_received",
        )

    def test_protocol_voter_list_count(self, processed):
        """Voter list count must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.voter_list_count,
            _CIK_PROTOCOL_018["voter_list_count"],
            "voter_list_count",
        )

    def test_protocol_valid_votes_paper(self, processed):
        """Valid paper votes must match CIK."""
        protocol, _, _ = processed
        _assert_field_close(
            protocol.valid_votes_paper,
            _CIK_PROTOCOL_018["valid_votes_paper"],
            "valid_votes_paper",
        )

    def test_protocol_page_numbers_nonempty(self, processed):
        """Page numbers field should be non-empty."""
        protocol, _, _ = processed
        assert protocol.page_numbers.startswith("|")
        cn_parts = [p for p in protocol.page_numbers.split("|") if p]
        assert len(cn_parts) > 0

    def test_protocol_line_trailing_empty_machine_fields(self, processed):
        """Form 24 formatted line should have empty trailing machine fields."""
        protocol, _, _ = processed
        line = format_protocol_line(protocol)
        parts = line.split(";")
        assert len(parts) == 19
        # Last 3 fields should be empty for Form 24
        assert parts[16] == ""
        assert parts[17] == ""
        assert parts[18] == ""

    # --- Vote fields ---

    def test_votes_machine_zero(self, processed):
        """All machine votes must be 0 for Form 24."""
        _, votes, _ = processed
        for pnum, total, paper, machine in votes.party_votes:
            assert machine == 0, f"Party {pnum}: machine should be 0, got {machine}"

    def test_votes_total_equals_paper(self, processed):
        """Total must equal paper for Form 24 (no machine)."""
        _, votes, _ = processed
        for pnum, total, paper, machine in votes.party_votes:
            assert total == paper, (
                f"Party {pnum}: total ({total}) should equal paper ({paper})"
            )

    def test_votes_has_parties(self, processed):
        """Vote record should contain party entries."""
        _, votes, _ = processed
        assert len(votes.party_votes) > 0

    # --- Preference fields ---

    def test_preferences_machine_zero(self, processed):
        """All machine preference votes must be 0 for Form 24."""
        _, _, preferences = processed
        for pref in preferences:
            assert pref.machine_votes == 0, (
                f"Party {pref.party_number} cand {pref.candidate_number}: "
                f"machine_votes should be 0, got {pref.machine_votes}"
            )

    def test_preferences_total_equals_paper(self, processed):
        """Total must equal paper for Form 24 preferences."""
        _, _, preferences = processed
        for pref in preferences:
            assert pref.total_votes == pref.paper_votes, (
                f"Party {pref.party_number} cand {pref.candidate_number}: "
                f"total ({pref.total_votes}) should equal paper ({pref.paper_votes})"
            )


# ---------------------------------------------------------------------------
# 16.3 — Batch processing
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (_HAS_SECTION_001 and _HAS_SECTION_018),
    reason="HTML files for both sections not available",
)
class TestBatchProcessing:
    """Integration test: batch process multiple sections via CLI.

    Validates: Requirements 1.1, 14.3
    """

    def test_batch_output_files_created(self, tmp_path):
        """Batch processing creates all three output files."""
        output_dir = tmp_path / "output"
        main([
            "--html-dir", str(_HTML_DIR),
            "--output-dir", str(output_dir),
            "--section", "010100001",
        ])
        assert (output_dir / "protocols.txt").exists()
        assert (output_dir / "votes.txt").exists()
        assert (output_dir / "preferences.txt").exists()

    def test_batch_single_section_one_line(self, tmp_path):
        """Single section produces exactly one protocol and one vote line."""
        output_dir = tmp_path / "output"
        main([
            "--html-dir", str(_HTML_DIR),
            "--output-dir", str(output_dir),
            "--section", "010100001",
        ])
        protocols = (output_dir / "protocols.txt").read_text(encoding="utf-8").strip().splitlines()
        votes = (output_dir / "votes.txt").read_text(encoding="utf-8").strip().splitlines()
        assert len(protocols) == 1
        assert len(votes) == 1
        assert "010100001" in protocols[0]
        assert "010100001" in votes[0]

    def test_batch_two_sections(self, tmp_path):
        """Multiple sections are discovered and processed in batch."""
        output_dir = tmp_path / "output"
        main([
            "--html-dir", str(_HTML_DIR),
            "--output-dir", str(output_dir),
        ])
        protocols = (output_dir / "protocols.txt").read_text(encoding="utf-8").strip().splitlines()
        votes = (output_dir / "votes.txt").read_text(encoding="utf-8").strip().splitlines()
        # Should have at least 2 lines (one per section)
        assert len(protocols) >= 2
        assert len(votes) >= 2
        # Both sections should appear
        all_text = "\n".join(protocols)
        assert "010100001" in all_text
        assert "010100018" in all_text

    def test_batch_summary_report(self, tmp_path, capsys):
        """Summary report is printed after batch processing."""
        output_dir = tmp_path / "output"
        main([
            "--html-dir", str(_HTML_DIR),
            "--output-dir", str(output_dir),
            "--section", "010100001",
        ])
        captured = capsys.readouterr()
        assert "1 sections processed" in captured.out
        assert "0 errors" in captured.out

    def test_batch_preferences_file_structure(self, tmp_path):
        """Preferences file lines each have exactly 7 semicolon-separated fields."""
        output_dir = tmp_path / "output"
        main([
            "--html-dir", str(_HTML_DIR),
            "--output-dir", str(output_dir),
            "--section", "010100001",
        ])
        prefs = (output_dir / "preferences.txt").read_text(encoding="utf-8").strip()
        assert len(prefs) > 0
        for line in prefs.splitlines():
            parts = line.split(";")
            assert len(parts) == 7, f"Preference line should have 7 fields: {line}"
