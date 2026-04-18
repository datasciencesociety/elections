"""CIK-format output generation for protocols, votes, and preferences."""

from __future__ import annotations

from pathlib import Path

from .models import PreferenceRecord, ProtocolRecord, VoteRecord


def _field(value: int | None) -> str:
    """Format an optional integer field: None → empty string, else str(value)."""
    return "" if value is None else str(value)


def format_protocol_line(record: ProtocolRecord) -> str:
    """Format a ProtocolRecord as a semicolon-separated CIK line.

    Layout (19 fields total):
      formNumber;sectionCode;rikCode;pageNumbers;;;field7;field8;field11;
      field12;field13;field14;field15;field16;field17;field18;
      [field19;field20;field21]

    Fields 5-6 are always empty. For Form 24/28, fields 19-21 are empty
    (three trailing semicolons). For Form 26/30, fields 19-21 have values.
    """
    parts = [
        record.form_number,
        record.section_code,
        record.rik_code,
        record.page_numbers,
        "",  # field 5 (always empty)
        "",  # field 6 (always empty)
        _field(record.ballots_received),
        _field(record.voter_list_count),
        _field(record.additional_voters),
        _field(record.voted_count),
        _field(record.unused_ballots),
        _field(record.invalid_ballots),
        _field(record.paper_ballots),
        _field(record.invalid_votes),
        _field(record.no_support_votes_paper),
        _field(record.valid_votes_paper),
        _field(record.machine_ballots),
        _field(record.no_support_votes_machine),
        _field(record.valid_votes_machine),
    ]
    return ";".join(parts)


def format_vote_line(record: VoteRecord) -> str:
    """Format a VoteRecord as a semicolon-separated CIK line.

    Layout: formNumber;sectionCode;rikCode;partyNum1;total1;paper1;machine1;...
    """
    parts = [record.form_number, record.section_code, record.rik_code]
    for party_num, total, paper, machine in record.party_votes:
        parts.extend([str(party_num), str(total), str(paper), str(machine)])
    return ";".join(parts)


def format_preference_line(record: PreferenceRecord) -> str:
    """Format a PreferenceRecord as a semicolon-separated CIK line.

    Layout: formNumber;sectionCode;partyNumber;candidateNumber;totalVotes;paperVotes;machineVotes
    """
    parts = [
        record.form_number,
        record.section_code,
        str(record.party_number),
        str(record.candidate_number),
        str(record.total_votes),
        str(record.paper_votes),
        str(record.machine_votes),
    ]
    return ";".join(parts)


def write_protocols(records: list[ProtocolRecord], path: str) -> None:
    """Write all protocol records to a file, one line per record."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(format_protocol_line(record) + "\n")


def write_votes(records: list[VoteRecord], path: str) -> None:
    """Write all vote records to a file, one line per record."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(format_vote_line(record) + "\n")


def write_preferences(records: list[PreferenceRecord], path: str) -> None:
    """Write all preference records to a file, one line per record."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(format_preference_line(record) + "\n")
