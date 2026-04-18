# Feature: ocr-protocol-parser, Property 9: Total votes equals paper plus machine votes
"""Property-based tests for total = paper + machine vote invariant.

**Validates: Requirements 9.2, 11.3, 11.4, 12.3, 12.4**

Property 9: For any VoteRecord or PreferenceRecord, total_votes SHALL equal
paper_votes + machine_votes. For form types 24/28, machine_votes SHALL be 0
and total_votes SHALL equal paper_votes.
"""

from __future__ import annotations

import sys
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import PreferenceRecord, VoteRecord


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

party_number_st = st.integers(min_value=1, max_value=99)
candidate_number_st = st.integers(min_value=101, max_value=122)
vote_count_st = st.integers(min_value=0, max_value=999_999)
form_number_st = st.from_regex(r"[0-9]{8}", fullmatch=True)
section_code_st = st.from_regex(r"[0-9]{9}", fullmatch=True)
rik_code_st = st.from_regex(r"[0-9]{2}", fullmatch=True)

# Form types: 24/28 are paper-only, 26/30 include machine
paper_only_form_type_st = st.sampled_from([24, 28])
machine_form_type_st = st.sampled_from([26, 30])


# ---------------------------------------------------------------------------
# VoteRecord strategies
# ---------------------------------------------------------------------------

def _vote_record_st(is_machine: bool):
    """Strategy for VoteRecord with consistent total = paper + machine."""

    @st.composite
    def build(draw):
        form_number = draw(form_number_st)
        section_code = draw(section_code_st)
        rik_code = draw(rik_code_st)
        n_parties = draw(st.integers(min_value=1, max_value=15))
        party_nums = draw(
            st.lists(
                party_number_st,
                min_size=n_parties,
                max_size=n_parties,
                unique=True,
            )
        )
        party_votes = []
        for pn in party_nums:
            paper = draw(vote_count_st)
            if is_machine:
                machine = draw(vote_count_st)
            else:
                machine = 0
            total = paper + machine
            party_votes.append((pn, total, paper, machine))
        return VoteRecord(
            form_number=form_number,
            section_code=section_code,
            rik_code=rik_code,
            party_votes=party_votes,
        )

    return build()


vote_record_paper_only_st = _vote_record_st(is_machine=False)
vote_record_machine_st = _vote_record_st(is_machine=True)


# ---------------------------------------------------------------------------
# PreferenceRecord strategies
# ---------------------------------------------------------------------------

@st.composite
def preference_record_paper_only_st(draw):
    """Strategy for a paper-only PreferenceRecord."""
    paper = draw(vote_count_st)
    return PreferenceRecord(
        form_number=draw(form_number_st),
        section_code=draw(section_code_st),
        party_number=draw(party_number_st),
        candidate_number=draw(candidate_number_st),
        total_votes=paper,
        paper_votes=paper,
        machine_votes=0,
    )


@st.composite
def preference_record_machine_st(draw):
    """Strategy for a machine-form PreferenceRecord."""
    paper = draw(vote_count_st)
    machine = draw(vote_count_st)
    return PreferenceRecord(
        form_number=draw(form_number_st),
        section_code=draw(section_code_st),
        party_number=draw(party_number_st),
        candidate_number=draw(candidate_number_st),
        total_votes=paper + machine,
        paper_votes=paper,
        machine_votes=machine,
    )


# ---------------------------------------------------------------------------
# Property tests — VoteRecord
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(record=vote_record_paper_only_st)
def test_vote_record_paper_only_total_equals_paper(record: VoteRecord) -> None:
    """For Form 24/28: total == paper and machine == 0 for every party."""
    for pn, total, paper, machine in record.party_votes:
        assert machine == 0, f"Party {pn}: machine should be 0, got {machine}"
        assert total == paper, f"Party {pn}: total ({total}) != paper ({paper})"


@settings(max_examples=100)
@given(record=vote_record_machine_st)
def test_vote_record_machine_total_equals_paper_plus_machine(
    record: VoteRecord,
) -> None:
    """For Form 26/30: total == paper + machine for every party."""
    for pn, total, paper, machine in record.party_votes:
        assert total == paper + machine, (
            f"Party {pn}: total ({total}) != paper ({paper}) + machine ({machine})"
        )


# ---------------------------------------------------------------------------
# Property tests — PreferenceRecord
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(record=preference_record_paper_only_st())
def test_preference_record_paper_only_total_equals_paper(
    record: PreferenceRecord,
) -> None:
    """For Form 24/28: total == paper and machine == 0."""
    assert record.machine_votes == 0
    assert record.total_votes == record.paper_votes


@settings(max_examples=100)
@given(record=preference_record_machine_st())
def test_preference_record_machine_total_equals_paper_plus_machine(
    record: PreferenceRecord,
) -> None:
    """For Form 26/30: total == paper + machine."""
    assert record.total_votes == record.paper_votes + record.machine_votes
