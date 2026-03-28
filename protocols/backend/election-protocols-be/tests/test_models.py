"""Unit tests for Pydantic protocol models."""

import pytest
from election_protocols_be.models.protocol import (
    CandidatePreference,
    MachineBallots,
    PaperBallots,
    PartyVote,
    Protocol,
)
from pydantic import ValidationError


@pytest.mark.unit
class TestCandidatePreference:
    """Tests for CandidatePreference model."""

    def test_instantiation_with_valid_fields(self):
        """Test creating a CandidatePreference with valid fields."""
        pref = CandidatePreference(candidate_number=101, count=5)
        assert pref.candidate_number == 101
        assert pref.count == 5

    def test_json_serialization(self):
        """Test JSON serialization roundtrip."""
        pref = CandidatePreference(candidate_number=101, count=5)
        json_data = pref.model_dump()
        restored = CandidatePreference.model_validate(json_data)
        assert restored == pref

    def test_string_candidate_number_coerced_to_int(self):
        """Test that string candidate_number is coerced to int."""
        pref = CandidatePreference(candidate_number="101", count=5)
        assert pref.candidate_number == 101
        assert isinstance(pref.candidate_number, int)

    def test_invalid_count_type(self):
        """Test that invalid count type raises ValidationError."""
        with pytest.raises(ValidationError):
            CandidatePreference(candidate_number=101, count="five")


@pytest.mark.unit
class TestPartyVote:
    """Tests for PartyVote model."""

    def test_instantiation_with_required_fields(self):
        """Test creating PartyVote with only required fields."""
        vote = PartyVote(party_number=8, votes=100)
        assert vote.party_number == 8
        assert vote.votes == 100
        assert vote.preferences == []
        assert vote.no_preferences == 0

    def test_instantiation_with_all_fields(self, sample_candidate_preference):
        """Test creating PartyVote with all fields."""
        vote = PartyVote(
            party_number=1,
            votes=50,
            preferences=[sample_candidate_preference],
            no_preferences=5,
        )
        assert vote.party_number == 1
        assert vote.votes == 50
        assert len(vote.preferences) == 1
        assert vote.no_preferences == 5

    def test_default_preferences_is_empty_list(self):
        """Test that preferences defaults to empty list."""
        vote = PartyVote(party_number=1, votes=10)
        assert vote.preferences == []
        assert isinstance(vote.preferences, list)

    def test_default_no_preferences_is_zero(self):
        """Test that no_preferences defaults to 0."""
        vote = PartyVote(party_number=1, votes=10)
        assert vote.no_preferences == 0

    def test_json_serialization(self, sample_party_vote):
        """Test JSON serialization roundtrip."""
        json_data = sample_party_vote.model_dump()
        restored = PartyVote.model_validate(json_data)
        assert restored == sample_party_vote

    def test_string_party_number_coerced_to_int(self):
        """Test that string party_number is coerced to int (Pydantic v2 behavior)."""
        vote = PartyVote(party_number="8", votes=100)
        assert vote.party_number == 8
        assert isinstance(vote.party_number, int)

    def test_string_votes_coerced_to_int(self):
        """Test that string votes is coerced to int (Pydantic v2 behavior)."""
        vote = PartyVote(party_number=8, votes="100")
        assert vote.votes == 100
        assert isinstance(vote.votes, int)


@pytest.mark.unit
class TestPaperBallots:
    """Tests for PaperBallots model."""

    def test_instantiation_with_required_fields(self):
        """Test creating PaperBallots with required fields."""
        ballots = PaperBallots(
            total=300,
            unused_ballots=217,
            registered_vote=82,
            invalid_out_of_the_box=1,
            invalid_in_the_box=1,
            support_noone=0,
            total_valid_votes=81,
        )
        assert ballots.total == 300
        assert ballots.votes == []

    def test_instantiation_with_votes(self, sample_party_vote):
        """Test creating PaperBallots with votes."""
        ballots = PaperBallots(
            total=300,
            unused_ballots=217,
            registered_vote=82,
            invalid_out_of_the_box=1,
            invalid_in_the_box=1,
            support_noone=0,
            votes=[sample_party_vote],
            total_valid_votes=81,
        )
        assert len(ballots.votes) == 1
        assert ballots.votes[0] == sample_party_vote

    def test_json_serialization(self, sample_paper_ballots):
        """Test JSON serialization roundtrip."""
        json_data = sample_paper_ballots.model_dump()
        restored = PaperBallots.model_validate(json_data)
        assert restored == sample_paper_ballots

    def test_missing_required_field_raises(self):
        """Test that missing required field raises ValidationError."""
        with pytest.raises(ValidationError):
            PaperBallots(
                total=300,
                unused_ballots=217,
                registered_vote=82,
                invalid_out_of_the_box=1,
                invalid_in_the_box=1,
                support_noone=0,
            )

    def test_string_total_coerced_to_int(self):
        """Test that string total is coerced to int (Pydantic v2 behavior)."""
        ballots = PaperBallots(
            total="300",
            unused_ballots=217,
            registered_vote=82,
            invalid_out_of_the_box=1,
            invalid_in_the_box=1,
            support_noone=0,
            total_valid_votes=81,
        )
        assert ballots.total == 300
        assert isinstance(ballots.total, int)


@pytest.mark.unit
class TestMachineBallots:
    """Tests for MachineBallots model."""

    def test_instantiation_with_required_fields(self):
        """Test creating MachineBallots with required fields."""
        ballots = MachineBallots(
            total_votes=78,
            support_noone=2,
            total_valid_votes=76,
        )
        assert ballots.total_votes == 78
        assert ballots.votes == []

    def test_instantiation_with_votes(self, sample_party_vote):
        """Test creating MachineBallots with votes."""
        ballots = MachineBallots(
            total_votes=78,
            support_noone=2,
            total_valid_votes=76,
            votes=[sample_party_vote],
        )
        assert len(ballots.votes) == 1

    def test_json_serialization(self, sample_machine_ballots):
        """Test JSON serialization roundtrip."""
        json_data = sample_machine_ballots.model_dump()
        restored = MachineBallots.model_validate(json_data)
        assert restored == sample_machine_ballots


@pytest.mark.unit
class TestProtocol:
    """Tests for Protocol model."""

    def test_instantiation_with_nested_models(
        self,
        sample_paper_ballots,
        sample_machine_ballots,
    ):
        """Test creating Protocol with nested ballot models."""
        protocol = Protocol(
            sik_no="12020009",
            sik_type="paper",
            voter_count=427,
            additional_voter_count=3,
            registered_votes=160,
            paper_ballots=sample_paper_ballots,
            machine_ballots=sample_machine_ballots,
        )
        assert protocol.sik_no == "12020009"
        assert protocol.sik_type == "paper"
        assert protocol.voter_count == 427
        assert isinstance(protocol.paper_ballots, PaperBallots)
        assert isinstance(protocol.machine_ballots, MachineBallots)

    def test_parse_full_protocol_example(self, sample_protocol_data):
        """Test parsing the exact JSON from the task example."""
        protocol = Protocol.model_validate(sample_protocol_data)
        assert protocol.sik_no == "12020009"
        assert protocol.sik_type == "paper"
        assert protocol.voter_count == 427
        assert protocol.additional_voter_count == 3
        assert protocol.registered_votes == 160

        assert protocol.paper_ballots.total == 300
        assert protocol.paper_ballots.unused_ballots == 217
        assert protocol.paper_ballots.registered_vote == 82
        assert protocol.paper_ballots.invalid_out_of_the_box == 1
        assert protocol.paper_ballots.invalid_in_the_box == 1
        assert protocol.paper_ballots.support_noone == 0
        assert protocol.paper_ballots.total_valid_votes == 81
        assert len(protocol.paper_ballots.votes) == 1
        assert protocol.paper_ballots.votes[0].party_number == 8
        assert protocol.paper_ballots.votes[0].votes == 6
        assert len(protocol.paper_ballots.votes[0].preferences) == 1
        assert protocol.paper_ballots.votes[0].preferences[0].candidate_number == 102
        assert protocol.paper_ballots.votes[0].preferences[0].count == 3
        assert protocol.paper_ballots.votes[0].no_preferences == 1

        assert protocol.machine_ballots.total_votes == 78
        assert protocol.machine_ballots.support_noone == 2
        assert protocol.machine_ballots.total_valid_votes == 76
        assert len(protocol.machine_ballots.votes) == 1
        assert protocol.machine_ballots.votes[0].party_number == 1
        assert protocol.machine_ballots.votes[0].votes == 6
        assert len(protocol.machine_ballots.votes[0].preferences) == 1
        assert protocol.machine_ballots.votes[0].preferences[0].candidate_number == 101
        assert protocol.machine_ballots.votes[0].preferences[0].count == 3
        assert protocol.machine_ballots.votes[0].no_preferences == 3

    def test_json_roundtrip(self, sample_protocol):
        """Test JSON serialization and deserialization roundtrip."""
        json_data = sample_protocol.model_dump()
        restored = Protocol.model_validate(json_data)
        assert restored == sample_protocol

    def test_json_schema(self, sample_protocol):
        """Test that model generates correct JSON schema."""
        schema = sample_protocol.model_json_schema()
        assert "sik_no" in schema["properties"]
        assert "sik_type" in schema["properties"]
        assert "paper_ballots" in schema["properties"]
        assert "machine_ballots" in schema["properties"]

    def test_sik_no_as_string(self):
        """Test that sik_no preserves leading zeros as string."""
        protocol = Protocol(
            sik_no="01234567",
            sik_type="paper",
            voter_count=100,
            additional_voter_count=0,
            registered_votes=50,
            paper_ballots=PaperBallots(
                total=100,
                unused_ballots=50,
                registered_vote=50,
                invalid_out_of_the_box=0,
                invalid_in_the_box=0,
                support_noone=0,
                total_valid_votes=50,
            ),
            machine_ballots=MachineBallots(
                total_votes=0,
                support_noone=0,
                total_valid_votes=0,
            ),
        )
        assert protocol.sik_no == "01234567"
        assert len(protocol.sik_no) == 8

    def test_invalid_sik_type_raises(self):
        """Test that invalid sik_type still accepts string (no validation)."""
        protocol = Protocol(
            sik_no="12020009",
            sik_type="invalid_type",
            voter_count=100,
            additional_voter_count=0,
            registered_votes=50,
            paper_ballots=PaperBallots(
                total=100,
                unused_ballots=50,
                registered_vote=50,
                invalid_out_of_the_box=0,
                invalid_in_the_box=0,
                support_noone=0,
                total_valid_votes=50,
            ),
            machine_ballots=MachineBallots(
                total_votes=0,
                support_noone=0,
                total_valid_votes=0,
            ),
        )
        assert protocol.sik_type == "invalid_type"
