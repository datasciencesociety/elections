"""Unit tests for data models and exception hierarchy.

Validates: Requirements 15.4
"""

import pytest

from models import (
    # Exception hierarchy
    OCRParserError,
    FormTypeError,
    PageParseError,
    # Page-level data models
    Page1Data,
    Page2Data,
    VoteEntry,
    PaperVotesData,
    PreferenceEntry,
    PaperPreferencesData,
    MachineVotesData,
    MachinePreferencesData,
    # Aggregated output records
    ProtocolRecord,
    VoteRecord,
    PreferenceRecord,
    # Config
    LLMVerifierConfig,
)


# ---------------------------------------------------------------------------
# Exception hierarchy tests
# ---------------------------------------------------------------------------


class TestExceptionHierarchy:
    def test_ocr_parser_error_is_exception(self):
        assert issubclass(OCRParserError, Exception)

    def test_form_type_error_inherits_ocr_parser_error(self):
        assert issubclass(FormTypeError, OCRParserError)

    def test_page_parse_error_inherits_ocr_parser_error(self):
        assert issubclass(PageParseError, OCRParserError)

    def test_form_type_error_can_be_caught_as_ocr_parser_error(self):
        with pytest.raises(OCRParserError):
            raise FormTypeError("unknown form")

    def test_page_parse_error_can_be_caught_as_ocr_parser_error(self):
        with pytest.raises(OCRParserError):
            raise PageParseError("bad page")

    def test_exception_message_preserved(self):
        err = FormTypeError("form type not found on page 1")
        assert str(err) == "form type not found on page 1"


# ---------------------------------------------------------------------------
# Page1Data tests
# ---------------------------------------------------------------------------


class TestPage1Data:
    def test_creation_with_all_fields(self):
        p = Page1Data(
            control_number="0110151",
            form_type=26,
            form_number="01022018",
            section_code="010100001",
            rik_code="01",
            ballots_received=600,
        )
        assert p.control_number == "0110151"
        assert p.form_type == 26
        assert p.form_number == "01022018"
        assert p.section_code == "010100001"
        assert p.rik_code == "01"
        assert p.ballots_received == 600

    def test_ballots_received_none(self):
        p = Page1Data(
            control_number="0000001",
            form_type=24,
            form_number="01022018",
            section_code="010100018",
            rik_code="01",
            ballots_received=None,
        )
        assert p.ballots_received is None

    def test_all_valid_form_types(self):
        for ft in (24, 26, 28, 30):
            p = Page1Data("ctrl", ft, "num", "sec", "rik", 0)
            assert p.form_type == ft


# ---------------------------------------------------------------------------
# Page2Data tests
# ---------------------------------------------------------------------------


class TestPage2Data:
    def test_creation_with_all_fields(self):
        p = Page2Data(
            control_number="0110151",
            voter_list_count=500,
            additional_voters=10,
            voted_count=450,
            unused_ballots=150,
            invalid_ballots=5,
            paper_ballots_in_box=445,
            invalid_votes=3,
            no_support_votes=2,
        )
        assert p.voter_list_count == 500
        assert p.additional_voters == 10
        assert p.voted_count == 450
        assert p.unused_ballots == 150
        assert p.invalid_ballots == 5
        assert p.paper_ballots_in_box == 445
        assert p.invalid_votes == 3
        assert p.no_support_votes == 2

    def test_all_optional_fields_none(self):
        p = Page2Data(
            control_number="0000001",
            voter_list_count=None,
            additional_voters=None,
            voted_count=None,
            unused_ballots=None,
            invalid_ballots=None,
            paper_ballots_in_box=None,
            invalid_votes=None,
            no_support_votes=None,
        )
        assert p.voter_list_count is None
        assert p.additional_voters is None
        assert p.voted_count is None
        assert p.unused_ballots is None
        assert p.invalid_ballots is None
        assert p.paper_ballots_in_box is None
        assert p.invalid_votes is None
        assert p.no_support_votes is None


# ---------------------------------------------------------------------------
# VoteEntry tests
# ---------------------------------------------------------------------------


class TestVoteEntry:
    def test_creation(self):
        v = VoteEntry(party_number=2, vote_count=150)
        assert v.party_number == 2
        assert v.vote_count == 150

    def test_zero_votes(self):
        v = VoteEntry(party_number=18, vote_count=0)
        assert v.vote_count == 0


# ---------------------------------------------------------------------------
# PaperVotesData tests
# ---------------------------------------------------------------------------


class TestPaperVotesData:
    def test_creation(self):
        votes = [VoteEntry(2, 100), VoteEntry(4, 200)]
        p = PaperVotesData(
            control_numbers=["001", "002"],
            votes=votes,
            total_valid_paper_votes=300,
        )
        assert len(p.votes) == 2
        assert p.total_valid_paper_votes == 300
        assert p.control_numbers == ["001", "002"]

    def test_total_valid_paper_votes_none(self):
        p = PaperVotesData(control_numbers=[], votes=[], total_valid_paper_votes=None)
        assert p.total_valid_paper_votes is None

    def test_empty_votes_list(self):
        p = PaperVotesData(control_numbers=[], votes=[], total_valid_paper_votes=0)
        assert p.votes == []


# ---------------------------------------------------------------------------
# PreferenceEntry tests
# ---------------------------------------------------------------------------


class TestPreferenceEntry:
    def test_creation(self):
        pe = PreferenceEntry(party_number=2, candidate_number=101, vote_count=50)
        assert pe.party_number == 2
        assert pe.candidate_number == 101
        assert pe.vote_count == 50

    def test_zero_vote_count(self):
        pe = PreferenceEntry(party_number=4, candidate_number=122, vote_count=0)
        assert pe.vote_count == 0


# ---------------------------------------------------------------------------
# PaperPreferencesData tests
# ---------------------------------------------------------------------------


class TestPaperPreferencesData:
    def test_creation(self):
        prefs = [PreferenceEntry(2, 101, 10), PreferenceEntry(2, 102, 20)]
        p = PaperPreferencesData(control_numbers=["c1", "c2", "c3"], preferences=prefs)
        assert len(p.preferences) == 2
        assert p.control_numbers == ["c1", "c2", "c3"]

    def test_empty_preferences(self):
        p = PaperPreferencesData(control_numbers=[], preferences=[])
        assert p.preferences == []


# ---------------------------------------------------------------------------
# MachineVotesData tests
# ---------------------------------------------------------------------------


class TestMachineVotesData:
    def test_creation(self):
        votes = [VoteEntry(2, 80), VoteEntry(4, 120)]
        m = MachineVotesData(
            control_numbers=["m1", "m2"],
            votes=votes,
            machine_ballots_in_box=200,
            no_support_votes_machine=5,
            total_valid_machine_votes=195,
        )
        assert len(m.votes) == 2
        assert m.machine_ballots_in_box == 200
        assert m.no_support_votes_machine == 5
        assert m.total_valid_machine_votes == 195

    def test_all_optional_fields_none(self):
        m = MachineVotesData(
            control_numbers=[],
            votes=[],
            machine_ballots_in_box=None,
            no_support_votes_machine=None,
            total_valid_machine_votes=None,
        )
        assert m.machine_ballots_in_box is None
        assert m.no_support_votes_machine is None
        assert m.total_valid_machine_votes is None


# ---------------------------------------------------------------------------
# MachinePreferencesData tests
# ---------------------------------------------------------------------------


class TestMachinePreferencesData:
    def test_creation(self):
        prefs = [PreferenceEntry(2, 101, 30)]
        m = MachinePreferencesData(control_numbers=["m1"], preferences=prefs)
        assert len(m.preferences) == 1

    def test_empty(self):
        m = MachinePreferencesData(control_numbers=[], preferences=[])
        assert m.preferences == []


# ---------------------------------------------------------------------------
# ProtocolRecord tests
# ---------------------------------------------------------------------------


class TestProtocolRecord:
    def test_creation_form26(self):
        r = ProtocolRecord(
            form_number="01022018",
            section_code="010100001",
            rik_code="01",
            page_numbers="|0110151|0110151|0110151",
            field5="",
            field6="",
            ballots_received=600,
            voter_list_count=500,
            additional_voters=10,
            voted_count=450,
            unused_ballots=150,
            invalid_ballots=5,
            paper_ballots=445,
            invalid_votes=3,
            no_support_votes_paper=2,
            valid_votes_paper=440,
            machine_ballots=200,
            no_support_votes_machine=1,
            valid_votes_machine=199,
        )
        assert r.form_number == "01022018"
        assert r.machine_ballots == 200
        assert r.field5 == ""
        assert r.field6 == ""

    def test_creation_form24_no_machine(self):
        r = ProtocolRecord(
            form_number="01022018",
            section_code="010100018",
            rik_code="01",
            page_numbers="|001|002",
            field5="",
            field6="",
            ballots_received=300,
            voter_list_count=250,
            additional_voters=5,
            voted_count=200,
            unused_ballots=100,
            invalid_ballots=2,
            paper_ballots=198,
            invalid_votes=1,
            no_support_votes_paper=0,
            valid_votes_paper=197,
            machine_ballots=None,
            no_support_votes_machine=None,
            valid_votes_machine=None,
        )
        assert r.machine_ballots is None
        assert r.no_support_votes_machine is None
        assert r.valid_votes_machine is None

    def test_none_numeric_fields(self):
        r = ProtocolRecord(
            form_number="num",
            section_code="sec",
            rik_code="rik",
            page_numbers="",
            field5="",
            field6="",
            ballots_received=None,
            voter_list_count=None,
            additional_voters=None,
            voted_count=None,
            unused_ballots=None,
            invalid_ballots=None,
            paper_ballots=None,
            invalid_votes=None,
            no_support_votes_paper=None,
            valid_votes_paper=None,
            machine_ballots=None,
            no_support_votes_machine=None,
            valid_votes_machine=None,
        )
        assert r.ballots_received is None
        assert r.voter_list_count is None


# ---------------------------------------------------------------------------
# VoteRecord tests
# ---------------------------------------------------------------------------


class TestVoteRecord:
    def test_creation(self):
        r = VoteRecord(
            form_number="01022018",
            section_code="010100001",
            rik_code="01",
            party_votes=[(2, 150, 100, 50), (4, 200, 120, 80)],
        )
        assert len(r.party_votes) == 2
        assert r.party_votes[0] == (2, 150, 100, 50)

    def test_empty_party_votes(self):
        r = VoteRecord(
            form_number="num",
            section_code="sec",
            rik_code="rik",
            party_votes=[],
        )
        assert r.party_votes == []


# ---------------------------------------------------------------------------
# PreferenceRecord tests
# ---------------------------------------------------------------------------


class TestPreferenceRecord:
    def test_creation(self):
        r = PreferenceRecord(
            form_number="01022018",
            section_code="010100001",
            party_number=2,
            candidate_number=101,
            total_votes=80,
            paper_votes=50,
            machine_votes=30,
        )
        assert r.total_votes == 80
        assert r.paper_votes == 50
        assert r.machine_votes == 30

    def test_zero_machine_votes_form24(self):
        r = PreferenceRecord(
            form_number="01022018",
            section_code="010100018",
            party_number=4,
            candidate_number=105,
            total_votes=25,
            paper_votes=25,
            machine_votes=0,
        )
        assert r.machine_votes == 0
        assert r.total_votes == r.paper_votes


# ---------------------------------------------------------------------------
# LLMVerifierConfig tests
# ---------------------------------------------------------------------------


class TestLLMVerifierConfig:
    def test_creation(self):
        cfg = LLMVerifierConfig(
            api_base_url="https://api.openai.com/v1",
            api_key="sk-test-key",
            model="gpt-4o-mini",
            timeout=30,
            enabled=True,
        )
        assert cfg.api_base_url == "https://api.openai.com/v1"
        assert cfg.api_key == "sk-test-key"
        assert cfg.model == "gpt-4o-mini"
        assert cfg.timeout == 30
        assert cfg.enabled is True

    def test_disabled_config(self):
        cfg = LLMVerifierConfig(
            api_base_url="",
            api_key="",
            model="",
            timeout=0,
            enabled=False,
        )
        assert cfg.enabled is False
        assert cfg.timeout == 0
