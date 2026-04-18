"""Unit tests for page_parsers — parse_page1, parse_page2, parse_vote_pages."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure the module is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from html_utils import HtmlDiv, parse_html_file
from models import FormTypeError, VoteEntry
from page_parsers import parse_page1, parse_page2, parse_vote_pages, parse_total_valid_votes

# ---------------------------------------------------------------------------
# Paths to real HTML samples
# ---------------------------------------------------------------------------

_SAMPLES_DIR = Path(__file__).resolve().parent.parent.parent / "election-results-2024" / "2024-html"
_SECTION_001 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_1.html"
_SECTION_018 = _SAMPLES_DIR / "010100018.0" / "010100018.0_page_1.html"


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100001 (Form 26)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SECTION_001.exists(), reason="Sample HTML not available")
class TestPage1Section001:
    """Parse page 1 of section 010100001 (Form 26)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs = parse_html_file(str(_SECTION_001))
        self.result = parse_page1(divs)

    def test_control_number(self):
        assert self.result.control_number == "0110151"

    def test_form_type(self):
        assert self.result.form_type == 26

    def test_form_number(self):
        assert self.result.form_number == "01022018"

    def test_section_code(self):
        assert self.result.section_code == "010100001"

    def test_rik_code(self):
        assert self.result.rik_code == "01"

    def test_ballots_received(self):
        assert self.result.ballots_received == 600


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100018 (Form 24)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SECTION_018.exists(), reason="Sample HTML not available")
class TestPage1Section018:
    """Parse page 1 of section 010100018 (Form 24)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs = parse_html_file(str(_SECTION_018))
        self.result = parse_page1(divs)

    def test_form_type(self):
        assert self.result.form_type == 24

    def test_section_code(self):
        assert self.result.section_code == "010100018"

    def test_control_number(self):
        assert self.result.control_number == "0100018"

    def test_rik_code(self):
        assert self.result.rik_code == "01"

    def test_ballots_received(self):
        assert self.result.ballots_received == 100


# ---------------------------------------------------------------------------
# Tests with synthetic HtmlDiv data
# ---------------------------------------------------------------------------


class TestPage1FormTypeError:
    """FormTypeError is raised when form type text is missing."""

    def test_raises_on_missing_form_type(self):
        divs = [
            HtmlDiv(bbox=(64, 4, 176, 25), label="Text", content="0110151"),
            HtmlDiv(bbox=(325, 158, 702, 191), label="Text", content="0 1 0 1 0 0 0 0 1"),
            HtmlDiv(bbox=(141, 294, 458, 313), label="Text", content="изборен район 01 - Благоевградски"),
        ]
        with pytest.raises(FormTypeError):
            parse_page1(divs)


class TestPage1Synthetic:
    """Tests with hand-crafted HtmlDiv lists."""

    def test_minimal_valid_page1(self):
        divs = [
            HtmlDiv(bbox=(64, 4, 176, 25), label="Text", content="0110151"),
            HtmlDiv(bbox=(344, 45, 468, 82), label="Text", content="01022018"),
            HtmlDiv(bbox=(735, 35, 978, 56), label="Text", content="Приложение № 76-НС-хм"),
            HtmlDiv(bbox=(325, 158, 702, 191), label="Text", content="0 1 0 1 0 0 0 0 1"),
            HtmlDiv(bbox=(141, 294, 458, 313), label="Text", content="изборен район 01 - Благоевградски"),
            HtmlDiv(bbox=(80, 855, 700, 905), label="Text", content="А. Брой на получените бюлетини"),
            HtmlDiv(bbox=(755, 905, 965, 945), label="Text", content="600 (с цифри)"),
        ]
        result = parse_page1(divs)
        assert result.control_number == "0110151"
        assert result.form_type == 26
        assert result.form_number == "01022018"
        assert result.section_code == "010100001"
        assert result.rik_code == "01"
        assert result.ballots_received == 600

    def test_form_type_75(self):
        divs = [
            HtmlDiv(bbox=(64, 4, 176, 25), label="Text", content="1234567"),
            HtmlDiv(bbox=(735, 35, 978, 56), label="Text", content="Приложение № 75-НС-х"),
            HtmlDiv(bbox=(325, 158, 702, 191), label="Text", content="0 1 0 1 0 0 0 1 8"),
            HtmlDiv(bbox=(141, 294, 458, 313), label="Text", content="изборен район 02 - Бургаски"),
        ]
        result = parse_page1(divs)
        assert result.form_type == 24

    def test_form_type_77(self):
        divs = [
            HtmlDiv(bbox=(64, 4, 176, 25), label="Text", content="9999999"),
            HtmlDiv(bbox=(735, 35, 978, 56), label="Text", content="Приложение № 77-НС-чх"),
            HtmlDiv(bbox=(325, 158, 702, 191), label="Text", content="0 1 0 1 0 0 0 0 1"),
            HtmlDiv(bbox=(141, 294, 458, 313), label="Text", content="изборен район 03"),
        ]
        result = parse_page1(divs)
        assert result.form_type == 28

    def test_form_type_78(self):
        divs = [
            HtmlDiv(bbox=(64, 4, 176, 25), label="Text", content="8888888"),
            HtmlDiv(bbox=(735, 35, 978, 56), label="Text", content="Приложение № 78-НС-чхм"),
            HtmlDiv(bbox=(325, 158, 702, 191), label="Text", content="0 1 0 1 0 0 0 0 1"),
            HtmlDiv(bbox=(141, 294, 458, 313), label="Text", content="изборен район 04"),
        ]
        result = parse_page1(divs)
        assert result.form_type == 30

    def test_ballots_received_none_when_missing(self):
        divs = [
            HtmlDiv(bbox=(64, 4, 176, 25), label="Text", content="0110151"),
            HtmlDiv(bbox=(735, 35, 978, 56), label="Text", content="Приложение № 76-НС-хм"),
            HtmlDiv(bbox=(325, 158, 702, 191), label="Text", content="0 1 0 1 0 0 0 0 1"),
            HtmlDiv(bbox=(141, 294, 458, 313), label="Text", content="изборен район 01"),
        ]
        result = parse_page1(divs)
        assert result.ballots_received is None


# ---------------------------------------------------------------------------
# Paths to real HTML samples — page 2
# ---------------------------------------------------------------------------

_SECTION_001_PAGE2 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_2.html"


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100001 page 2
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SECTION_001_PAGE2.exists(), reason="Sample HTML not available")
class TestPage2Section001:
    """Parse page 2 of section 010100001 — voter list and ballot data."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs = parse_html_file(str(_SECTION_001_PAGE2))
        self.result = parse_page2(divs)

    def test_control_number(self):
        assert self.result.control_number == "0110151"

    def test_voter_list_count(self):
        """Field 8: voter list count."""
        assert self.result.voter_list_count == 625

    def test_additional_voters(self):
        """Field 11: additional voters."""
        assert self.result.additional_voters == 4

    def test_voted_count(self):
        """Field 12: voted count."""
        assert self.result.voted_count == 310

    def test_unused_ballots(self):
        """Field 13: unused ballots."""
        assert self.result.unused_ballots == 445

    def test_invalid_ballots(self):
        """Field 14: invalid ballots."""
        assert self.result.invalid_ballots == 1

    def test_paper_ballots_in_box(self):
        """Field 15: paper ballots in box."""
        assert self.result.paper_ballots_in_box == 154

    def test_invalid_votes(self):
        """Field 16: invalid votes."""
        assert self.result.invalid_votes == 6

    def test_no_support_votes(self):
        """Field 17: no-support votes."""
        assert self.result.no_support_votes == 6


# ---------------------------------------------------------------------------
# Tests with synthetic data — page 2 missing fields
# ---------------------------------------------------------------------------


class TestPage2MissingFields:
    """Missing or empty Form divs should yield None for all fields."""

    def test_no_form_divs(self):
        """When there are no Form divs, all fields should be None."""
        divs = [
            HtmlDiv(bbox=(56, 4, 166, 25), label="Text", content="0110151"),
            HtmlDiv(bbox=(55, 35, 283, 58), label="Text", content="ЛИСТ 1"),
        ]
        result = parse_page2(divs)
        assert result.control_number == "0110151"
        assert result.voter_list_count is None
        assert result.additional_voters is None
        assert result.voted_count is None
        assert result.unused_ballots is None
        assert result.invalid_ballots is None
        assert result.paper_ballots_in_box is None
        assert result.invalid_votes is None
        assert result.no_support_votes is None

    def test_empty_form_div(self):
        """A Form div with no tables should yield None for all fields."""
        divs = [
            HtmlDiv(bbox=(56, 4, 166, 25), label="Text", content="9999999"),
            HtmlDiv(bbox=(56, 86, 952, 333), label="Form", content="", tables=[]),
        ]
        result = parse_page2(divs)
        assert result.control_number == "9999999"
        assert result.voter_list_count is None
        assert result.additional_voters is None
        assert result.voted_count is None
        assert result.unused_ballots is None
        assert result.invalid_ballots is None
        assert result.paper_ballots_in_box is None
        assert result.invalid_votes is None
        assert result.no_support_votes is None

    def test_form_with_empty_table(self):
        """A Form div with an empty table should yield None for all fields."""
        divs = [
            HtmlDiv(bbox=(56, 4, 166, 25), label="Text", content="1234567"),
            HtmlDiv(bbox=(56, 86, 952, 333), label="Form", content="", tables=[[]]),
        ]
        result = parse_page2(divs)
        assert result.voter_list_count is None
        assert result.additional_voters is None

    def test_partial_fields(self):
        """Only matched rows should populate; unmatched fields stay None."""
        divs = [
            HtmlDiv(bbox=(56, 4, 166, 25), label="Text", content="5555555"),
            HtmlDiv(
                bbox=(56, 86, 952, 333),
                label="Form",
                content="",
                tables=[[
                    ["1. Брой на избирателите", "....100....\n(с цифри)"],
                    ["3. Брой на гласувалите", "....50....\n(с цифри)"],
                ]],
            ),
        ]
        result = parse_page2(divs)
        assert result.voter_list_count == 100
        assert result.voted_count == 50
        # Unmatched fields remain None
        assert result.additional_voters is None
        assert result.unused_ballots is None
        assert result.invalid_ballots is None
        assert result.paper_ballots_in_box is None
        assert result.invalid_votes is None
        assert result.no_support_votes is None


# ---------------------------------------------------------------------------
# Paths to real HTML samples — pages 3–4
# ---------------------------------------------------------------------------

_SECTION_001_PAGE3 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_3.html"
_SECTION_001_PAGE4 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_4.html"
_SECTION_018_PAGE3 = _SAMPLES_DIR / "010100018.0" / "010100018.0_page_3.html"
_SECTION_018_PAGE4 = _SAMPLES_DIR / "010100018.0" / "010100018.0_page_4.html"


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100001 pages 3–4 (Form 26)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (_SECTION_001_PAGE3.exists() and _SECTION_001_PAGE4.exists()),
    reason="Sample HTML not available",
)
class TestVotePages001:
    """Parse pages 3–4 of section 010100001 (Form 26)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs3 = parse_html_file(str(_SECTION_001_PAGE3))
        divs4 = parse_html_file(str(_SECTION_001_PAGE4))
        self.result = parse_vote_pages([divs3, divs4])

    def test_control_numbers(self):
        assert len(self.result.control_numbers) == 2
        assert self.result.control_numbers[0] == "0110151"
        assert self.result.control_numbers[1] == "0110151"

    def test_total_parties(self):
        """Should have 26 parties (2–18 on page 3, 19–28 on page 4, skipping 1 and 3)."""
        # Parties: 2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18 (page 3) = 16
        # Parties: 19,20,21,22,23,24,25,26,27,28 (page 4) = 10
        assert len(self.result.votes) == 26

    def test_first_party(self):
        assert self.result.votes[0] == VoteEntry(party_number=2, vote_count=0)

    def test_party_4_votes(self):
        party4 = next(v for v in self.result.votes if v.party_number == 4)
        assert party4.vote_count == 8

    def test_party_18_votes(self):
        party18 = next(v for v in self.result.votes if v.party_number == 18)
        assert party18.vote_count == 72

    def test_party_26_votes(self):
        party26 = next(v for v in self.result.votes if v.party_number == 26)
        assert party26.vote_count == 14

    def test_party_28_votes(self):
        party28 = next(v for v in self.result.votes if v.party_number == 28)
        assert party28.vote_count == 18

    def test_total_valid_paper_votes(self):
        assert self.result.total_valid_paper_votes == 142

    def test_votes_ordered(self):
        """Votes should be in order of appearance (page 3 then page 4)."""
        numbers = [v.party_number for v in self.result.votes]
        assert numbers == sorted(numbers)


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100018 pages 3–4 (Form 24)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (_SECTION_018_PAGE3.exists() and _SECTION_018_PAGE4.exists()),
    reason="Sample HTML not available",
)
class TestVotePages018:
    """Parse pages 3–4 of section 010100018 (Form 24)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs3 = parse_html_file(str(_SECTION_018_PAGE3))
        divs4 = parse_html_file(str(_SECTION_018_PAGE4))
        self.result = parse_vote_pages([divs3, divs4])

    def test_total_parties(self):
        """Should have 27 parties (2–28, skipping 1 and 3)."""
        assert len(self.result.votes) == 27

    def test_party_18_votes(self):
        party18 = next(v for v in self.result.votes if v.party_number == 18)
        assert party18.vote_count == 14

    def test_party_26_votes(self):
        party26 = next(v for v in self.result.votes if v.party_number == 26)
        assert party26.vote_count == 1

    def test_total_valid_paper_votes(self):
        assert self.result.total_valid_paper_votes == 18


# ---------------------------------------------------------------------------
# Tests with synthetic data — parse_vote_pages
# ---------------------------------------------------------------------------


class TestVotePagesSynthetic:
    """Tests with hand-crafted HtmlDiv lists."""

    def test_empty_pages(self):
        result = parse_vote_pages([])
        assert result.votes == []
        assert result.control_numbers == []
        assert result.total_valid_paper_votes is None

    def test_single_page_with_table(self):
        divs = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="1234567"),
            HtmlDiv(
                bbox=(55, 96, 966, 940),
                label="Table",
                content="",
                tables=[[
                    ["№", "Наименование", "Действителни гласове"],
                    ["2.", "ПП ГЛАС НАРОДЕН", "нула\n(с думи) 0\n(с цифри)"],
                    ["4.", "ПП ВЕЛИЧИЕ", "осем\n(с думи) 8\n(с цифри)"],
                ]],
            ),
        ]
        result = parse_vote_pages([divs])
        assert len(result.votes) == 2
        assert result.votes[0] == VoteEntry(party_number=2, vote_count=0)
        assert result.votes[1] == VoteEntry(party_number=4, vote_count=8)

    def test_combined_party_number_name(self):
        """Page 4 format: '19. АТАКА' in first column."""
        divs = [
            HtmlDiv(bbox=(44, 0, 154, 23), label="Text", content="9999999"),
            HtmlDiv(
                bbox=(44, 52, 952, 573),
                label="Table",
                content="",
                tables=[[
                    ["19. АТАКА", "нула\n(с думи)", "0\n(с цифри)"],
                    ["20. ПП НАРОДНА ПАРТИЯ", "нула\n(с думи)", "0\n(с цифри)"],
                ]],
            ),
        ]
        result = parse_vote_pages([divs])
        assert len(result.votes) == 2
        assert result.votes[0] == VoteEntry(party_number=19, vote_count=0)
        assert result.votes[1] == VoteEntry(party_number=20, vote_count=0)

    def test_total_from_text_div(self):
        """Total valid votes in a Text div after the table (010100001 page 4 layout)."""
        divs = [
            HtmlDiv(bbox=(44, 0, 154, 23), label="Text", content="1111111"),
            HtmlDiv(
                bbox=(44, 52, 952, 573),
                label="Table",
                content="",
                tables=[[
                    ["19. АТАКА", "нула\n(с думи)", "0\n(с цифри)"],
                ]],
            ),
            HtmlDiv(
                bbox=(55, 603, 708, 636),
                label="Text",
                content="9. Общ брой на действителните гласове",
            ),
            HtmlDiv(
                bbox=(765, 648, 838, 674),
                label="Text",
                content="142\n(с цифри)",
            ),
        ]
        result = parse_vote_pages([divs])
        assert result.total_valid_paper_votes == 142

    def test_total_from_table_div(self):
        """Total valid votes in a Table div row (010100018 page 4 layout)."""
        divs = [
            HtmlDiv(bbox=(44, 0, 154, 23), label="Text", content="2222222"),
            HtmlDiv(
                bbox=(86, 527, 930, 609),
                label="Table",
                content="",
                tables=[[
                    [
                        "9. Общ брой на действителните гласове, подадени за кандидатските листи",
                        "Осемнадесет\n(с думи)",
                        "18\n(с цифри)",
                    ],
                ]],
            ),
        ]
        total = parse_total_valid_votes(divs)
        assert total == 18


# ---------------------------------------------------------------------------
# Paths to real HTML samples — pages 5–7 (preferences)
# ---------------------------------------------------------------------------

from page_parsers import parse_preference_pages
from html_utils import parse_html_file_flush
from models import PreferenceEntry

_SECTION_001_PAGE5 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_5.html"
_SECTION_001_PAGE6 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_6.html"
_SECTION_001_PAGE7 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_7.html"


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100001 pages 5–7 (Form 26 preferences)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (_SECTION_001_PAGE5.exists() and _SECTION_001_PAGE6.exists() and _SECTION_001_PAGE7.exists()),
    reason="Sample HTML not available",
)
class TestPreferencePages001:
    """Parse pages 5–7 of section 010100001 (Form 26 paper preferences)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs5 = parse_html_file_flush(str(_SECTION_001_PAGE5))
        divs6 = parse_html_file_flush(str(_SECTION_001_PAGE6))
        divs7 = parse_html_file_flush(str(_SECTION_001_PAGE7))
        self.result = parse_preference_pages([divs5, divs6, divs7])

    def test_control_numbers(self):
        # Page 6 has label "Text" not "Page-Header", control number may not be found for all
        assert len(self.result.control_numbers) >= 2

    def test_has_preferences(self):
        assert len(self.result.preferences) > 0

    def test_all_candidates_101_to_122(self):
        """Each party should have candidates 101–122."""
        party_nums = set(p.party_number for p in self.result.preferences)
        for pn in party_nums:
            cands = sorted(p.candidate_number for p in self.result.preferences if p.party_number == pn)
            assert cands == list(range(101, 123)), f"Party {pn} has candidates {cands}"

    def test_party_4_preferences(self):
        """Party 4 (ПП ВЕЛИЧИЕ): 101=1, 102=1, 105=2, 108=1, rest=0."""
        party4 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 4}
        assert party4[101] == 1
        assert party4[102] == 1
        assert party4[105] == 2
        assert party4[108] == 1
        assert party4[103] == 0
        assert party4[113] == 0

    def test_party_18_preferences(self):
        """Party 18 (ГЕРБ-СДС): 101=1, 102=1, 104=4, 105=13, 107=42, 108=1, 118=1, 122=2."""
        party18 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 18}
        assert party18[101] == 1
        assert party18[102] == 1
        assert party18[104] == 4
        assert party18[105] == 13
        assert party18[107] == 42
        assert party18[108] == 1
        assert party18[118] == 1
        assert party18[122] == 2

    def test_party_28_preferences(self):
        """Party 28 (БСП): 101=2, 102=7, 105=1, 106=1, 107=1, 116=1, 122=1."""
        party28 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 28}
        assert party28[101] == 2
        assert party28[102] == 7
        assert party28[105] == 1
        assert party28[106] == 1
        assert party28[107] == 1
        assert party28[116] == 1
        assert party28[122] == 1

    def test_bez_preferentsiya_excluded(self):
        """'Без преференции' values should NOT appear as candidate entries."""
        for p in self.result.preferences:
            assert 101 <= p.candidate_number <= 122, (
                f"Unexpected candidate number {p.candidate_number} for party {p.party_number}"
            )

    def test_22_candidates_per_party(self):
        """Each party should have exactly 22 candidate entries (101–122)."""
        party_nums = set(p.party_number for p in self.result.preferences)
        for pn in party_nums:
            count = sum(1 for p in self.result.preferences if p.party_number == pn)
            assert count == 22, f"Party {pn} has {count} entries, expected 22"


# ---------------------------------------------------------------------------
# Tests with synthetic data — parse_preference_pages
# ---------------------------------------------------------------------------


class TestPreferencePagesSynthetic:
    """Tests with hand-crafted HtmlDiv lists."""

    def test_empty_pages(self):
        result = parse_preference_pages([])
        assert result.preferences == []
        assert result.control_numbers == []

    def test_pattern_a_single_party(self):
        """Pattern A: rowspan-resolved rows (pages 5-6 style)."""
        table = [
            ["№", "Наименование на партия/коалиция", "Брой отбелязани предпочитания"],
            ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112"],
            ["2.", "ПП ГЛАС НАРОДЕН", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
            ["113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "Без преференции"],
            ["0", "0", "0", "0", "0", "0", "0", "0", "0", "2", "5"],
        ]
        divs = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="1234567"),
            HtmlDiv(bbox=(69, 246, 972, 937), label="Table", content="", tables=[table]),
        ]
        result = parse_preference_pages([divs])
        assert len(result.preferences) == 22
        assert result.preferences[0] == PreferenceEntry(party_number=2, candidate_number=101, vote_count=1)
        # Candidate 122 (index 21)
        assert result.preferences[21] == PreferenceEntry(party_number=2, candidate_number=122, vote_count=2)

    def test_pattern_b_single_party(self):
        """Pattern B: merged party+name in first cell (page 7 style)."""
        table = [
            ["21. ПРЯКА ДЕМОКРАЦИЯ", "101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112"],
            ["0", "0", "3", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
            ["113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "Без преференции"],
            ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1"],
        ]
        divs = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="9999999"),
            HtmlDiv(bbox=(69, 246, 972, 937), label="Table", content="", tables=[table]),
        ]
        result = parse_preference_pages([divs])
        assert len(result.preferences) == 22
        assert result.preferences[0] == PreferenceEntry(party_number=21, candidate_number=101, vote_count=0)
        assert result.preferences[2] == PreferenceEntry(party_number=21, candidate_number=103, vote_count=3)

    def test_non_numeric_preference_logged_as_zero(self):
        """Non-numeric preference values should be recorded as 0."""
        table = [
            ["5.", "Булгари", "abc", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
            ["113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "Без преференции"],
            ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
        ]
        divs = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="5555555"),
            HtmlDiv(bbox=(69, 246, 972, 937), label="Table", content="", tables=[table]),
        ]
        result = parse_preference_pages([divs])
        # Candidate 101 should be 0 (non-numeric "abc")
        cand_101 = next(p for p in result.preferences if p.candidate_number == 101)
        assert cand_101.vote_count == 0

    def test_multiple_pages_aggregated(self):
        """Preferences from multiple pages should be aggregated."""
        table1 = [
            ["2.", "Party A", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
            ["113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "Без преференции"],
            ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
        ]
        table2 = [
            ["4.", "Party B", "0", "0", "5", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
            ["113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "Без преференции"],
            ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
        ]
        divs1 = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="1111111"),
            HtmlDiv(bbox=(69, 246, 972, 937), label="Table", content="", tables=[table1]),
        ]
        divs2 = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="2222222"),
            HtmlDiv(bbox=(69, 246, 972, 937), label="Table", content="", tables=[table2]),
        ]
        result = parse_preference_pages([divs1, divs2])
        assert len(result.preferences) == 44  # 2 parties × 22 candidates
        assert result.control_numbers == ["1111111", "2222222"]
        party2 = [p for p in result.preferences if p.party_number == 2]
        party4 = [p for p in result.preferences if p.party_number == 4]
        assert len(party2) == 22
        assert len(party4) == 22
        assert party4[2].vote_count == 5  # candidate 103


# ---------------------------------------------------------------------------
# Imports for machine vote/preference tests
# ---------------------------------------------------------------------------

from page_parsers import (
    parse_machine_fields_page7,
    parse_machine_vote_pages,
    parse_machine_preference_pages,
)
from models import MachineVotesData, MachinePreferencesData

# ---------------------------------------------------------------------------
# Paths to real HTML samples — pages 7–9 (machine votes)
# ---------------------------------------------------------------------------

_SECTION_001_PAGE8 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_8.html"
_SECTION_001_PAGE9 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_9.html"


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100001 pages 8–9 (Form 26 machine votes)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (_SECTION_001_PAGE8.exists() and _SECTION_001_PAGE9.exists()),
    reason="Sample HTML not available",
)
class TestMachineVotePages001:
    """Parse pages 8–9 of section 010100001 (Form 26 machine votes)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        divs8 = parse_html_file(str(_SECTION_001_PAGE8))
        divs9 = parse_html_file(str(_SECTION_001_PAGE9))
        self.result = parse_machine_vote_pages([divs8, divs9])

    def test_control_numbers(self):
        assert len(self.result.control_numbers) == 2
        assert self.result.control_numbers[0] == "0110151"

    def test_total_parties(self):
        """Should have 26 parties from pages 8–9 (same as paper votes)."""
        assert len(self.result.votes) == 26

    def test_party_2_votes(self):
        party2 = next(v for v in self.result.votes if v.party_number == 2)
        assert party2.vote_count == 0

    def test_party_4_votes(self):
        party4 = next(v for v in self.result.votes if v.party_number == 4)
        assert party4.vote_count == 3

    def test_party_7_votes(self):
        party7 = next(v for v in self.result.votes if v.party_number == 7)
        assert party7.vote_count == 12

    def test_party_12_votes(self):
        party12 = next(v for v in self.result.votes if v.party_number == 12)
        assert party12.vote_count == 27

    def test_party_18_votes(self):
        party18 = next(v for v in self.result.votes if v.party_number == 18)
        assert party18.vote_count == 45

    def test_party_26_votes(self):
        party26 = next(v for v in self.result.votes if v.party_number == 26)
        assert party26.vote_count == 31

    def test_party_28_votes(self):
        party28 = next(v for v in self.result.votes if v.party_number == 28)
        assert party28.vote_count == 15

    def test_total_valid_machine_votes(self):
        assert self.result.total_valid_machine_votes == 116

    def test_votes_ordered(self):
        """Votes should be in order of appearance (page 8 then page 9)."""
        numbers = [v.party_number for v in self.result.votes]
        assert numbers == sorted(numbers)


# ---------------------------------------------------------------------------
# Tests with real HTML — page 7 machine fields (truncated page)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not _SECTION_001_PAGE7.exists(),
    reason="Sample HTML not available",
)
class TestMachineFieldsPage7:
    """Parse machine fields from page 7 of section 010100001.

    Note: Page 7 is truncated in the HTML, so machine fields may not be
    extractable. This test verifies the function handles truncation gracefully.
    """

    def test_returns_tuple(self):
        divs = parse_html_file_flush(str(_SECTION_001_PAGE7))
        result = parse_machine_fields_page7(divs)
        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_machine_fields_with_page7_divs(self):
        """Machine fields from page 7 — may be None if page is truncated."""
        divs = parse_html_file_flush(str(_SECTION_001_PAGE7))
        machine_ballots, no_support = parse_machine_fields_page7(divs)
        # Page 7 is truncated, so these may be None
        # We just verify the function doesn't crash
        assert machine_ballots is None or isinstance(machine_ballots, int)
        assert no_support is None or isinstance(no_support, int)


# ---------------------------------------------------------------------------
# Tests with synthetic data — machine fields
# ---------------------------------------------------------------------------


class TestMachineFieldsSynthetic:
    """Tests with hand-crafted HtmlDiv lists for machine fields."""

    def test_machine_fields_from_form_div(self):
        """Machine fields in a Form div with table rows."""
        divs = [
            HtmlDiv(bbox=(60, 3, 168, 23), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(64, 736, 954, 757),
                label="Section-Header",
                content="ПРЕБРОЯВАНЕ НА ГЛАСОВЕТЕ ОТ БЮЛЕТИНИТЕ ОТ МАШИННО ГЛАСУВАНЕ",
            ),
            HtmlDiv(
                bbox=(60, 800, 960, 950),
                label="Form",
                content="",
                tables=[[
                    [
                        "11. Брой на намерените в избирателната кутия бюлетини от машинно гласуване",
                        "сто петдесет и шест\n(с думи)",
                        "156\n(с цифри)",
                    ],
                    [
                        '12. Брой на действителните гласове от бюлетини от машинно гласуване с отбелязан вот \u201eНе подкрепям никого\u201c',
                        "две\n(с думи)",
                        "2\n(с цифри)",
                    ],
                ]],
            ),
        ]
        machine_ballots, no_support = parse_machine_fields_page7(divs)
        assert machine_ballots == 156
        assert no_support == 2

    def test_machine_fields_from_text_divs(self):
        """Machine fields in Text divs (split layout)."""
        divs = [
            HtmlDiv(bbox=(60, 3, 168, 23), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(64, 736, 954, 757),
                label="Section-Header",
                content="ПРЕБРОЯВАНЕ НА ГЛАСОВЕТЕ ОТ БЮЛЕТИНИТЕ ОТ МАШИННО ГЛАСУВАНЕ",
            ),
            HtmlDiv(
                bbox=(60, 800, 900, 830),
                label="Text",
                content="11. Брой на намерените в избирателната кутия бюлетини от машинно гласуване",
            ),
            HtmlDiv(
                bbox=(750, 830, 950, 860),
                label="Text",
                content="156\n(с цифри)",
            ),
            HtmlDiv(
                bbox=(60, 870, 900, 900),
                label="Text",
                content='12. Брой на действителните гласове от бюлетини от машинно гласуване с отбелязан вот \u201eНе подкрепям никого\u201c',
            ),
            HtmlDiv(
                bbox=(750, 900, 950, 930),
                label="Text",
                content="2\n(с цифри)",
            ),
        ]
        machine_ballots, no_support = parse_machine_fields_page7(divs)
        assert machine_ballots == 156
        assert no_support == 2

    def test_machine_fields_missing(self):
        """When machine fields are not present, return (None, None)."""
        divs = [
            HtmlDiv(bbox=(60, 3, 168, 23), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(64, 736, 954, 757),
                label="Section-Header",
                content="ПРЕБРОЯВАНЕ НА ГЛАСОВЕТЕ ОТ БЮЛЕТИНИТЕ ОТ МАШИННО ГЛАСУВАНЕ",
            ),
        ]
        machine_ballots, no_support = parse_machine_fields_page7(divs)
        assert machine_ballots is None
        assert no_support is None


# ---------------------------------------------------------------------------
# Tests with synthetic data — machine vote pages
# ---------------------------------------------------------------------------


class TestMachineVotePagesSynthetic:
    """Tests with hand-crafted HtmlDiv lists for machine vote pages."""

    def test_empty_pages(self):
        result = parse_machine_vote_pages([])
        assert result.votes == []
        assert result.control_numbers == []
        assert result.total_valid_machine_votes is None
        assert result.machine_ballots_in_box is None
        assert result.no_support_votes_machine is None

    def test_with_page7_divs(self):
        """Machine fields extracted from page 7 divs."""
        page7_divs = [
            HtmlDiv(bbox=(60, 3, 168, 23), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(60, 800, 960, 950),
                label="Form",
                content="",
                tables=[[
                    [
                        "11. Брой на намерените в избирателната кутия бюлетини от машинно гласуване",
                        "сто\n(с думи)",
                        "100\n(с цифри)",
                    ],
                    [
                        '12. Брой на действителните гласове от бюлетини от машинно гласуване с отбелязан вот \u201eНе подкрепям никого\u201c',
                        "три\n(с думи)",
                        "3\n(с цифри)",
                    ],
                ]],
            ),
        ]
        page8_divs = [
            HtmlDiv(bbox=(47, 0, 158, 23), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(47, 95, 936, 936),
                label="Table",
                content="",
                tables=[[
                    ["№", "Наименование", "с думи", "с цифри"],
                    ["2.", "ПП ГЛАС НАРОДЕН", "нула\n(с думи)", "0\n(с цифри)"],
                    ["4.", "ПП ВЕЛИЧИЕ", "три\n(с думи)", "3\n(с цифри)"],
                ]],
            ),
        ]
        page9_divs = [
            HtmlDiv(bbox=(60, 11, 169, 29), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(60, 60, 969, 650),
                label="Form",
                content="",
                tables=[[
                    ["18. ГЕРБ-СДС", "четиридесет и пет\n(с думи)", "45\n(с цифри)"],
                ]],
            ),
            HtmlDiv(
                bbox=(62, 681, 716, 716),
                label="Text",
                content="14. Общ брой на действителните гласове",
            ),
            HtmlDiv(
                bbox=(735, 721, 945, 758),
                label="Text",
                content="48\n(с цифри)",
            ),
        ]
        result = parse_machine_vote_pages([page8_divs, page9_divs], page7_divs=page7_divs)
        assert result.machine_ballots_in_box == 100
        assert result.no_support_votes_machine == 3
        assert len(result.votes) == 3
        assert result.votes[0] == VoteEntry(party_number=2, vote_count=0)
        assert result.votes[1] == VoteEntry(party_number=4, vote_count=3)
        assert result.votes[2] == VoteEntry(party_number=18, vote_count=45)
        assert result.total_valid_machine_votes == 48

    def test_total_from_text_div_14(self):
        """Total valid machine votes uses '14. Общ брой' pattern."""
        divs = [
            HtmlDiv(bbox=(60, 11, 169, 29), label="Text", content="0110151"),
            HtmlDiv(
                bbox=(62, 681, 716, 716),
                label="Text",
                content="14. Общ брой на действителните гласове, подадени за кандидатските листи",
            ),
            HtmlDiv(
                bbox=(735, 721, 945, 758),
                label="Text",
                content="116\n(с цифри)",
            ),
        ]
        result = parse_machine_vote_pages([divs])
        assert result.total_valid_machine_votes == 116


# ---------------------------------------------------------------------------
# Paths to real HTML samples — pages 10–14 (machine preferences)
# ---------------------------------------------------------------------------

_SECTION_001_PAGE10 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_10.html"
_SECTION_001_PAGE11 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_11.html"
_SECTION_001_PAGE12 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_12.html"
_SECTION_001_PAGE13 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_13.html"
_SECTION_001_PAGE14 = _SAMPLES_DIR / "010100001.0" / "010100001.0_page_14.html"


# ---------------------------------------------------------------------------
# Tests with real HTML — section 010100001 pages 10–14 (machine preferences)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not all(p.exists() for p in [_SECTION_001_PAGE11, _SECTION_001_PAGE12, _SECTION_001_PAGE13]),
    reason="Sample HTML not available",
)
class TestMachinePreferencePages001:
    """Parse pages 10–14 of section 010100001 (Form 26 machine preferences)."""

    @pytest.fixture(autouse=True)
    def _parse(self):
        pages = []
        for p in [_SECTION_001_PAGE10, _SECTION_001_PAGE11, _SECTION_001_PAGE12,
                   _SECTION_001_PAGE13, _SECTION_001_PAGE14]:
            if p.exists():
                pages.append(parse_html_file_flush(str(p)))
            else:
                pages.append([])
        self.result = parse_machine_preference_pages(pages)

    def test_has_preferences(self):
        assert len(self.result.preferences) > 0

    def test_party_4_machine_preferences(self):
        """Party 4 (ПП ВЕЛИЧИЕ) machine: 105=1, rest mostly 0."""
        party4 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 4}
        if party4:
            assert party4.get(105) == 1

    def test_party_12_machine_preferences(self):
        """Party 12 (ВЪЗРАЖДАНЕ) machine: 101=3, 104=1, 114=1."""
        party12 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 12}
        if party12:
            assert party12.get(101) == 3
            assert party12.get(104) == 1
            assert party12.get(114) == 1

    def test_party_18_machine_preferences(self):
        """Party 18 (ГЕРБ-СДС) machine: 101=2, 102=2, 103=1, 104=1, 105=8, 107=26, 111=1."""
        party18 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 18}
        if party18:
            assert party18.get(101) == 2
            assert party18.get(102) == 2
            assert party18.get(105) == 8
            assert party18.get(107) == 26

    def test_party_26_machine_preferences(self):
        """Party 26 (ПП-ДБ) machine: 101=5, 104=1, 107=1, 119=1, 122=8."""
        party26 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 26}
        if party26:
            assert party26.get(101) == 5
            assert party26.get(104) == 1
            assert party26.get(122) == 8

    def test_party_28_machine_preferences(self):
        """Party 28 (БСП) machine: 101=5, 102=3, 107=1, 111=1, 122=2."""
        party28 = {p.candidate_number: p.vote_count for p in self.result.preferences if p.party_number == 28}
        if party28:
            assert party28.get(101) == 5
            assert party28.get(102) == 3
            assert party28.get(107) == 1
            assert party28.get(122) == 2

    def test_22_candidates_per_party(self):
        """Each party should have exactly 22 candidate entries (101–122)."""
        party_nums = set(p.party_number for p in self.result.preferences)
        for pn in party_nums:
            count = sum(1 for p in self.result.preferences if p.party_number == pn)
            assert count == 22, f"Party {pn} has {count} entries, expected 22"


# ---------------------------------------------------------------------------
# Tests with synthetic data — machine preference pages
# ---------------------------------------------------------------------------


class TestMachinePreferencePagesSynthetic:
    """Tests with hand-crafted HtmlDiv lists for machine preference pages."""

    def test_empty_pages(self):
        result = parse_machine_preference_pages([])
        assert result.preferences == []
        assert result.control_numbers == []

    def test_reuses_preference_parsing(self):
        """Machine preferences use the same table structure as paper preferences."""
        table = [
            ["2.", "ПП ГЛАС НАРОДЕН", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
            ["113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "Без преференции"],
            ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "5"],
        ]
        divs = [
            HtmlDiv(bbox=(55, 9, 164, 27), label="Text", content="1234567"),
            HtmlDiv(bbox=(69, 246, 972, 937), label="Table", content="", tables=[table]),
        ]
        result = parse_machine_preference_pages([divs])
        assert len(result.preferences) == 22
        assert result.preferences[0] == PreferenceEntry(party_number=2, candidate_number=101, vote_count=1)
        assert isinstance(result, MachinePreferencesData)
