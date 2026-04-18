"""Data models and exception hierarchy for the OCR Protocol Parser."""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------


class OCRParserError(Exception):
    """Base exception for all OCR parser errors."""


class FormTypeError(OCRParserError):
    """Raised when the form type cannot be detected on page 1."""


class PageParseError(OCRParserError):
    """Raised when a page cannot be parsed correctly."""


# ---------------------------------------------------------------------------
# Page-level data models
# ---------------------------------------------------------------------------


@dataclass
class Page1Data:
    """Data extracted from page 1 of a protocol (header fields)."""

    control_number: str
    form_type: int  # 24, 26, 28, 30
    form_number: str  # e.g. "01022018"
    section_code: str  # e.g. "010100001"
    rik_code: str  # e.g. "01"
    ballots_received: int | None


@dataclass
class Page2Data:
    """Data extracted from page 2 of a protocol (voter list / ballot data)."""

    control_number: str
    voter_list_count: int | None  # field 8
    additional_voters: int | None  # field 11
    voted_count: int | None  # field 12
    unused_ballots: int | None  # field 13
    invalid_ballots: int | None  # field 14
    paper_ballots_in_box: int | None  # field 15
    invalid_votes: int | None  # field 16
    no_support_votes: int | None  # field 17


@dataclass
class VoteEntry:
    """A single party's vote count."""

    party_number: int
    vote_count: int


@dataclass
class PaperVotesData:
    """Paper vote distribution extracted from pages 3–4."""

    control_numbers: list[str]
    votes: list[VoteEntry]
    total_valid_paper_votes: int | None  # field 18


@dataclass
class PreferenceEntry:
    """A single candidate preference vote."""

    party_number: int
    candidate_number: int
    vote_count: int


@dataclass
class PaperPreferencesData:
    """Paper preference votes extracted from pages 5–7."""

    control_numbers: list[str]
    preferences: list[PreferenceEntry]
    bez_preferentsii: dict[int, int]  # party_number -> "Без преференции" count


@dataclass
class MachineVotesData:
    """Machine vote distribution extracted from pages 8–9 (Form 26/30 only)."""

    control_numbers: list[str]
    votes: list[VoteEntry]
    machine_ballots_in_box: int | None  # field 19
    no_support_votes_machine: int | None  # field 20
    total_valid_machine_votes: int | None  # field 21


@dataclass
class MachinePreferencesData:
    """Machine preference votes extracted from pages 10–14 (Form 26/30 only)."""

    control_numbers: list[str]
    preferences: list[PreferenceEntry]
    bez_preferentsii: dict[int, int]  # party_number -> "Без преференции" count


# ---------------------------------------------------------------------------
# Aggregated output records
# ---------------------------------------------------------------------------


@dataclass
class ProtocolRecord:
    """Aggregated protocol data for one section (protocols.txt line)."""

    form_number: str
    section_code: str
    rik_code: str
    page_numbers: str  # pipe-separated: |num1|num2|...|numN
    field5: str  # empty
    field6: str  # empty
    ballots_received: int | None
    voter_list_count: int | None
    additional_voters: int | None
    voted_count: int | None
    unused_ballots: int | None
    invalid_ballots: int | None
    paper_ballots: int | None
    invalid_votes: int | None
    no_support_votes_paper: int | None
    valid_votes_paper: int | None
    machine_ballots: int | None  # None for form 24/28
    no_support_votes_machine: int | None  # None for form 24/28
    valid_votes_machine: int | None  # None for form 24/28


@dataclass
class VoteRecord:
    """Aggregated vote distribution for one section (votes.txt line)."""

    form_number: str
    section_code: str
    rik_code: str
    party_votes: list[tuple[int, int, int, int]]  # (party_num, total, paper, machine)


@dataclass
class PreferenceRecord:
    """Aggregated preference data for one candidate in one section (preferences.txt line)."""

    form_number: str
    section_code: str
    party_number: int
    candidate_number: str  # "101"-"122" or "Без"
    total_votes: int
    paper_votes: int
    machine_votes: int


# ---------------------------------------------------------------------------
# LLM Verifier configuration
# ---------------------------------------------------------------------------


@dataclass
class LLMVerifierConfig:
    """Configuration for the optional LLM verification layer."""

    api_base_url: str
    api_key: str
    model: str
    timeout: int
    enabled: bool
