"""Unit tests for Pydantic protocol models."""

import pytest
from election_protocols_be.models.protocol import (
    CandidatePreference,
    MachineBallots,
    PaperBallots,
    PartyVote,
    Protocol,
    REGION_MAX_PREFERENCES,
)
from pydantic import ValidationError


def _party_votes(region: int) -> list[PartyVote]:
    """All required PartyVotes for a region — correct preference count, all ballot counts zero."""
    prefs = [CandidatePreference(candidate_number=100 + i, count=0) for i in range(1, REGION_MAX_PREFERENCES[region] + 1)]
    party_numbers = list(range(1, 29)) + ([29] if region == 15 else [])
    return [
        PartyVote(party_number=p, votes=0, preferences=[] if (region == 15 and p == 29) else prefs, no_preferences=0)
        for p in party_numbers
    ]


def _minimal_protocol(sik_no: str, region: int, sik_type: str = "paper_machine", **overrides) -> Protocol:
    """Build a minimal valid Protocol for the given region (all ballot counts zero)."""
    votes = _party_votes(region)
    machine = MachineBallots(total_votes=0, support_noone=0, total_valid_votes=0, votes=votes) if sik_type == "paper_machine" else None
    defaults = dict(
        sik_no=sik_no,
        sik_type=sik_type,
        voter_count=100,
        additional_voter_count=0,
        registered_votes=0,
        paper_ballots=PaperBallots(
            total=100, unused_ballots=100, registered_vote=0,
            invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
            votes=votes, total_valid_votes=0,
        ),
        machine_ballots=machine,
    )
    return Protocol(**{**defaults, **overrides})


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

    def test_instantiation_with_nested_models(self, sample_paper_ballots, sample_machine_ballots):
        """Test creating Protocol with nested ballot models."""
        protocol = Protocol(
            sik_no="120200009",
            sik_type="paper_machine",
            voter_count=427,
            additional_voter_count=3,
            registered_votes=0,
            paper_ballots=sample_paper_ballots,
            machine_ballots=sample_machine_ballots,
        )
        assert protocol.sik_no == "120200009"
        assert protocol.sik_type == "paper_machine"
        assert protocol.voter_count == 427
        assert isinstance(protocol.paper_ballots, PaperBallots)
        assert isinstance(protocol.machine_ballots, MachineBallots)

    def test_parse_full_protocol_example(self, sample_protocol_data):
        """Test parsing the complete protocol JSON fixture."""
        protocol = Protocol.model_validate(sample_protocol_data)
        assert protocol.sik_no == "120200009"
        assert protocol.sik_type == "paper_machine"
        assert protocol.voter_count == 427
        assert protocol.additional_voter_count == 3
        assert protocol.registered_votes == 0

        assert protocol.paper_ballots.total == 300
        assert protocol.paper_ballots.unused_ballots == 300
        assert protocol.paper_ballots.registered_vote == 0
        assert protocol.paper_ballots.invalid_out_of_the_box == 0
        assert protocol.paper_ballots.invalid_in_the_box == 0
        assert protocol.paper_ballots.support_noone == 0
        assert protocol.paper_ballots.total_valid_votes == 0
        assert len(protocol.paper_ballots.votes) == 28
        assert {v.party_number for v in protocol.paper_ballots.votes} == set(range(1, 29))
        assert len(protocol.paper_ballots.votes[0].preferences) == 8

        assert protocol.machine_ballots.total_votes == 0
        assert protocol.machine_ballots.support_noone == 0
        assert protocol.machine_ballots.total_valid_votes == 0
        assert len(protocol.machine_ballots.votes) == 28
        assert {v.party_number for v in protocol.machine_ballots.votes} == set(range(1, 29))

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
        protocol = _minimal_protocol("012345678", region=1)
        assert protocol.sik_no == "012345678"
        assert len(protocol.sik_no) == 9

    def test_invalid_sik_type_raises(self):
        """Test that invalid sik_type raises ValidationError."""
        with pytest.raises(ValidationError):
            Protocol(
                sik_no="120200009",
                sik_type="invalid_type",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100,
                    unused_ballots=100,
                    registered_vote=0,
                    invalid_out_of_the_box=0,
                    invalid_in_the_box=0,
                    support_noone=0,
                    total_valid_votes=0,
                ),
                machine_ballots=MachineBallots(
                    total_votes=0,
                    support_noone=0,
                    total_valid_votes=0,
                ),
            )

    def test_parse_from_json_string(self):
        """Test parsing a Protocol from a raw JSON string — region 12, all 28 parties."""
        import json
        region = 12
        prefs = [{"candidate_number": 100 + i, "count": 0} for i in range(1, REGION_MAX_PREFERENCES[region] + 1)]
        votes = [{"party_number": p, "votes": 0, "preferences": prefs, "no_preferences": 0} for p in range(1, 29)]
        json_str = json.dumps({
            "sik_no": "120200009",
            "sik_type": "paper_machine",
            "voter_count": 500,
            "additional_voter_count": 5,
            "registered_votes": 0,
            "paper_ballots": {
                "total": 300, "unused_ballots": 300, "registered_vote": 0,
                "invalid_out_of_the_box": 0, "invalid_in_the_box": 0, "support_noone": 0,
                "votes": votes, "total_valid_votes": 0,
            },
            "machine_ballots": {
                "total_votes": 0, "support_noone": 0, "total_valid_votes": 0, "votes": votes,
            },
        })

        protocol = Protocol.model_validate_json(json_str)

        assert protocol.sik_no == "120200009"
        assert protocol.sik_type == "paper_machine"
        assert protocol.voter_count == 500
        assert len(protocol.paper_ballots.votes) == 28
        assert len(protocol.paper_ballots.votes[0].preferences) == 8

    def test_validate_preferences_count_wrong_count_raises(self):
        """Test that wrong preference count raises ValidationError — all 28 parties present but 7 prefs instead of 8."""
        wrong_prefs = [CandidatePreference(candidate_number=100 + i, count=0) for i in range(1, 8)]  # 7, needs 8
        votes = [PartyVote(party_number=p, votes=0, preferences=wrong_prefs) for p in range(1, 29)]
        with pytest.raises(ValidationError, match="preferences"):
            Protocol(
                sik_no="120200009",
                sik_type="paper_machine",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,
                ),
                machine_ballots=MachineBallots(total_votes=0, support_noone=0, total_valid_votes=0, votes=votes),
            )

    def test_paper_type_must_not_have_machine_ballots(self):
        """Test that sik_type 'paper' with machine_ballots raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="machine_ballots must not be present"):
            Protocol(
                sik_no="120200009",
                sik_type="paper",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,
                ),
                machine_ballots=MachineBallots(total_votes=0, support_noone=0, total_valid_votes=0, votes=votes),
            )

    def test_paper_machine_type_must_have_machine_ballots(self):
        """Test that sik_type 'paper_machine' without machine_ballots raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="machine_ballots is required"):
            Protocol(
                sik_no="120200009",
                sik_type="paper_machine",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,
                ),
            )

    def test_paper_type_without_machine_ballots_passes(self):
        """Test that sik_type 'paper' without machine_ballots passes validation."""
        protocol = _minimal_protocol("120200009", region=12, sik_type="paper")
        assert protocol.sik_type == "paper"
        assert protocol.machine_ballots is None

    def test_validate_preferences_count_region_with_zero_prefs(self):
        """Test that region 32 (prefs=0) rejects any preference entries — all 28 parties present."""
        votes_with_prefs = [
            PartyVote(party_number=p, votes=0, preferences=[CandidatePreference(candidate_number=101, count=0)])
            for p in range(1, 29)
        ]
        with pytest.raises(ValidationError, match="preferences"):
            Protocol(
                sik_no="320000001",
                sik_type="paper_machine",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes_with_prefs, total_valid_votes=0,
                ),
                machine_ballots=MachineBallots(total_votes=0, support_noone=0, total_valid_votes=0, votes=votes_with_prefs),
            )

    def test_validate_region_32_no_preferences_passes(self):
        """Test that region 32 with no preferences on any party passes validation."""
        protocol = _minimal_protocol("320000001", region=32)
        all_votes = protocol.paper_ballots.votes + (protocol.machine_ballots.votes if protocol.machine_ballots else [])
        for v in all_votes:
            assert v.preferences == []

    def test_validate_party_numbers_missing_raises(self):
        """Test that missing a party number raises ValidationError."""
        votes = _party_votes(12)
        votes_missing_one = [v for v in votes if v.party_number != 5]
        with pytest.raises(ValidationError, match="missing party numbers"):
            Protocol(
                sik_no="120200009",
                sik_type="paper",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes_missing_one, total_valid_votes=0,
                ),
            )

    def test_validate_party_numbers_duplicate_raises(self):
        """Test that duplicate party numbers raise ValidationError."""
        votes = _party_votes(12)
        votes_with_dupe = votes + [votes[0]]
        with pytest.raises(ValidationError, match="duplicate party numbers"):
            Protocol(
                sik_no="120200009",
                sik_type="paper",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes_with_dupe, total_valid_votes=0,
                ),
            )

    def test_validate_party_numbers_region_15_requires_29(self):
        """Test that region 15 requires party 29 in addition to 1-28."""
        votes_without_29 = _party_votes(12)  # only 1-28, no 29
        with pytest.raises(ValidationError, match="missing party numbers"):
            Protocol(
                sik_no="150000001",
                sik_type="paper",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes_without_29, total_valid_votes=0,
                ),
            )

    def test_validate_party_numbers_region_15_with_29_passes(self):
        """Test that region 15 with parties 1-29 (party 29 has empty prefs) passes validation."""
        protocol = _minimal_protocol("150000001", region=15)
        assert {v.party_number for v in protocol.paper_ballots.votes} == set(range(1, 30))
        party_29 = next(v for v in protocol.paper_ballots.votes if v.party_number == 29)
        assert party_29.preferences == []

    def test_validate_region_15_party_29_with_prefs_raises(self):
        """Test that region 15 party 29 with non-empty preferences raises ValidationError."""
        votes = _party_votes(15)
        votes = [
            PartyVote(party_number=v.party_number, votes=0, preferences=[CandidatePreference(candidate_number=101, count=0)])
            if v.party_number == 29 else v
            for v in votes
        ]
        with pytest.raises(ValidationError, match="preferences"):
            Protocol(
                sik_no="150000001",
                sik_type="paper_machine",
                voter_count=100,
                additional_voter_count=0,
                registered_votes=0,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,
                ),
                machine_ballots=MachineBallots(total_votes=0, support_noone=0, total_valid_votes=0, votes=votes),
            )

    # --- Controls for sik_type 'paper_machine' ---

    def test_control_1_registered_votes_le_total_voters_passes(self):
        """Control 1: registered_votes <= voter_count + additional_voter_count is valid."""
        protocol = _minimal_protocol("120200009", region=12, voter_count=100, additional_voter_count=5)
        assert protocol.registered_votes == 0  # 0 ≤ 105

    def test_control_1_registered_votes_exceeds_total_voters_raises(self):
        """Control 1: registered_votes > voter_count + additional_voter_count raises ValidationError."""
        with pytest.raises(ValidationError, match="control_1"):
            _minimal_protocol("120200009", region=12, voter_count=100, additional_voter_count=5, registered_votes=106)

    def test_control_2_registered_votes_eq_paper_plus_machine_passes(self):
        """Control 2: registered_votes == paper.registered_vote + machine.total_votes is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        assert protocol.registered_votes == 0  # 0 == 0+0

    def test_control_2_registered_votes_mismatch_raises(self):
        """Control 2: registered_votes != paper.registered_vote + machine.total_votes raises ValidationError."""
        with pytest.raises(ValidationError, match="control_2"):
            _minimal_protocol("120200009", region=12, registered_votes=50)
            # 50 != paper.registered_vote(0) + machine.total_votes(0) = 0

    def test_control_3_paper_total_eq_components_passes(self):
        """Control 3: paper_ballots.total == unused_ballots + invalid_out_of_the_box + registered_vote is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        assert protocol.paper_ballots.total == 100  # 100 == 100+0+0

    def test_control_3_paper_total_mismatch_raises(self):
        """Control 3: paper_ballots.total != components raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="control_3"):
            _minimal_protocol(
                "120200009", region=12,
                paper_ballots=PaperBallots(
                    total=999, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,
                ),
            )

    def test_control_4_paper_total_valid_votes_eq_sum_passes(self):
        """Control 4: paper_ballots.total_valid_votes == sum of votes is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        assert protocol.paper_ballots.total_valid_votes == 0  # 0 == sum([0]*28)

    def test_control_4_paper_total_valid_votes_mismatch_raises(self):
        """Control 4: paper_ballots.total_valid_votes != sum of votes raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="control_4"):
            _minimal_protocol(
                "120200009", region=12,
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=50,  # should be 0
                ),
            )

    def test_control_5_paper_registered_vote_eq_components_passes(self):
        """Control 5: paper_ballots.registered_vote == invalid_in_the_box + support_noone + total_valid_votes is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        assert protocol.paper_ballots.registered_vote == 0  # 0 == 0+0+0

    def test_control_5_paper_registered_vote_mismatch_raises(self):
        """Control 5: paper_ballots.registered_vote != components raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="control_5"):
            _minimal_protocol(
                "120200009", region=12,
                registered_votes=50,  # = paper.registered_vote(50) + machine.total_votes(0) (control_2)
                paper_ballots=PaperBallots(
                    total=150, unused_ballots=100, registered_vote=50,  # 100+0+50=150 (control_3)
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,  # 50 != 0+0+0=0 (control_5 raises)
                ),
            )

    def test_control_6_paper_party_votes_eq_preferences_sum_passes(self):
        """Control 6: each paper party vote.votes == sum(preferences.count) + no_preferences is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        for vote in protocol.paper_ballots.votes:
            assert vote.votes == 0  # 0 == sum([0]*8) + 0

    def test_control_6_paper_party_votes_mismatch_raises(self):
        """Control 6: paper party vote.votes != preferences sum raises ValidationError."""
        votes = _party_votes(12)
        bad_votes = [
            PartyVote(party_number=v.party_number, votes=5 if v.party_number == 1 else 0,
                      preferences=v.preferences, no_preferences=0)
            for v in votes
        ]
        with pytest.raises(ValidationError, match="control_6"):
            _minimal_protocol(
                "120200009", region=12,
                registered_votes=5,        # = paper.registered_vote(5) + machine.total_votes(0) (control_2)
                paper_ballots=PaperBallots(
                    total=105, unused_ballots=100, registered_vote=5,  # 100+0+5=105 (control_3)
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=bad_votes, total_valid_votes=5,  # sum=5+0*27=5 (control_4), 5==0+0+5 (control_5)
                    # control_6: party 1 votes(5) != sum(prefs.count)=0+no_prefs=0 → RAISES
                ),
            )

    def test_control_7_machine_total_valid_votes_eq_sum_passes(self):
        """Control 7: machine_ballots.total_valid_votes == sum of machine votes is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        assert protocol.machine_ballots.total_valid_votes == 0  # 0 == sum([0]*28)

    def test_control_7_machine_total_valid_votes_mismatch_raises(self):
        """Control 7: machine_ballots.total_valid_votes != sum of machine votes raises ValidationError."""
        with pytest.raises(ValidationError, match="control_7"):
            _minimal_protocol(
                "120200009", region=12,
                registered_votes=50,  # = paper.registered_vote(0) + machine.total_votes(50) (control_2)
                machine_ballots=MachineBallots(
                    total_votes=50, support_noone=0, total_valid_votes=50,  # 0+50=50 (control_8)
                    votes=_party_votes(12),  # sum=0 != total_valid_votes=50 (control_7 raises)
                ),
            )

    def test_control_8_machine_total_votes_eq_components_passes(self):
        """Control 8: machine_ballots.total_votes == support_noone + total_valid_votes is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        assert protocol.machine_ballots.total_votes == 0  # 0 == 0+0

    def test_control_8_machine_total_votes_mismatch_raises(self):
        """Control 8: machine_ballots.total_votes != support_noone + total_valid_votes raises ValidationError."""
        with pytest.raises(ValidationError, match="control_8"):
            _minimal_protocol(
                "120200009", region=12,
                registered_votes=50,  # = paper.registered_vote(0) + machine.total_votes(50) (control_2)
                machine_ballots=MachineBallots(
                    total_votes=50, support_noone=0, total_valid_votes=0,  # 0+0=0 != 50 (control_8 raises)
                    # control_7: total_valid_votes(0) == sum(votes)=0 ✓ (passes before control_8)
                    votes=_party_votes(12),
                ),
            )

    def test_control_9_machine_party_votes_eq_preferences_sum_passes(self):
        """Control 9: each machine party vote.votes == sum(preferences.count) + no_preferences is valid."""
        protocol = _minimal_protocol("120200009", region=12)
        for vote in protocol.machine_ballots.votes:
            assert vote.votes == 0  # 0 == sum([0]*8) + 0

    def test_control_9_machine_party_votes_mismatch_raises(self):
        """Control 9: machine party vote.votes != preferences sum raises ValidationError."""
        bad_votes = [
            PartyVote(party_number=v.party_number, votes=5 if v.party_number == 1 else 0,
                      preferences=v.preferences, no_preferences=0)
            for v in _party_votes(12)
        ]
        with pytest.raises(ValidationError, match="control_9"):
            _minimal_protocol(
                "120200009", region=12,
                registered_votes=5,  # = paper.registered_vote(0) + machine.total_votes(5) (control_2)
                machine_ballots=MachineBallots(
                    total_votes=5, support_noone=0, total_valid_votes=5,  # 0+5=5 (control_8), sum=5 (control_7)
                    votes=bad_votes,
                    # control_9: party 1 votes(5) != sum(prefs.count)=0+no_prefs=0 → RAISES
                ),
            )

    # --- Controls for sik_type 'paper' ---

    def test_paper_control_1_registered_votes_le_total_voters_passes(self):
        """Paper control 1: registered_votes <= voter_count + additional_voter_count is valid."""
        protocol = _minimal_protocol("120200009", region=12, sik_type="paper", voter_count=100, additional_voter_count=5)
        assert protocol.registered_votes == 0  # 0 ≤ 105

    def test_paper_control_1_registered_votes_exceeds_total_voters_raises(self):
        """Paper control 1: registered_votes > voter_count + additional_voter_count raises ValidationError."""
        with pytest.raises(ValidationError, match="paper_control_1"):
            _minimal_protocol("120200009", region=12, sik_type="paper",
                              voter_count=100, additional_voter_count=5, registered_votes=106)

    def test_paper_control_2_paper_total_eq_components_passes(self):
        """Paper control 2: paper_ballots.total == unused + invalid_out_of_the_box + registered_vote is valid."""
        protocol = _minimal_protocol("120200009", region=12, sik_type="paper")
        assert protocol.paper_ballots.total == 100  # 100 == 100+0+0

    def test_paper_control_2_paper_total_mismatch_raises(self):
        """Paper control 2: paper_ballots.total != components raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="paper_control_2"):
            _minimal_protocol(
                "120200009", region=12, sik_type="paper",
                paper_ballots=PaperBallots(
                    total=999, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,
                ),
            )

    def test_paper_control_3_paper_total_valid_votes_eq_sum_passes(self):
        """Paper control 3: paper_ballots.total_valid_votes == sum of votes is valid."""
        protocol = _minimal_protocol("120200009", region=12, sik_type="paper")
        assert protocol.paper_ballots.total_valid_votes == 0  # 0 == sum([0]*28)

    def test_paper_control_3_paper_total_valid_votes_mismatch_raises(self):
        """Paper control 3: paper_ballots.total_valid_votes != sum of votes raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="paper_control_3"):
            _minimal_protocol(
                "120200009", region=12, sik_type="paper",
                paper_ballots=PaperBallots(
                    total=100, unused_ballots=100, registered_vote=0,
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=50,  # should be 0
                ),
            )

    def test_paper_control_4_paper_registered_vote_eq_components_passes(self):
        """Paper control 4: paper_ballots.registered_vote == invalid_in + support_noone + total_valid_votes is valid."""
        protocol = _minimal_protocol("120200009", region=12, sik_type="paper")
        assert protocol.paper_ballots.registered_vote == 0  # 0 == 0+0+0

    def test_paper_control_4_paper_registered_vote_mismatch_raises(self):
        """Paper control 4: paper_ballots.registered_vote != components raises ValidationError."""
        votes = _party_votes(12)
        with pytest.raises(ValidationError, match="paper_control_4"):
            _minimal_protocol(
                "120200009", region=12, sik_type="paper",
                paper_ballots=PaperBallots(
                    total=150, unused_ballots=100, registered_vote=50,  # 100+0+50=150 (paper_control_2 ✓)
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=votes, total_valid_votes=0,  # sum=0 (paper_control_3 ✓), 50 != 0+0+0 RAISES
                ),
            )

    def test_paper_control_5_paper_party_votes_eq_preferences_sum_passes(self):
        """Paper control 5: each paper party vote.votes == sum(preferences.count) + no_preferences is valid."""
        protocol = _minimal_protocol("120200009", region=12, sik_type="paper")
        for vote in protocol.paper_ballots.votes:
            assert vote.votes == 0  # 0 == sum([0]*8) + 0

    def test_paper_control_5_paper_party_votes_mismatch_raises(self):
        """Paper control 5: paper party vote.votes != preferences sum raises ValidationError."""
        votes = _party_votes(12)
        bad_votes = [
            PartyVote(party_number=v.party_number, votes=5 if v.party_number == 1 else 0,
                      preferences=v.preferences, no_preferences=0)
            for v in votes
        ]
        with pytest.raises(ValidationError, match="paper_control_5"):
            _minimal_protocol(
                "120200009", region=12, sik_type="paper",
                paper_ballots=PaperBallots(
                    total=105, unused_ballots=100, registered_vote=5,  # 100+0+5=105 (paper_control_2 ✓)
                    invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                    votes=bad_votes, total_valid_votes=5,  # sum=5 (paper_control_3 ✓), 5==0+0+5 (paper_control_4 ✓)
                    # paper_control_5: party 1 votes(5) != sum(prefs.count=0)*8+no_prefs(0)=0 → RAISES
                ),
            )

    def test_paper_control_5_skipped_for_region_32(self):
        """Paper control 5 is skipped for region 32 (no preferences); votes can differ from preferences sum."""
        # votes=3, no_preferences=0 → would fail paper_control_5 if applied (3 != 0+0)
        votes = [PartyVote(party_number=p, votes=3, preferences=[], no_preferences=0) for p in range(1, 29)]
        protocol = _minimal_protocol(
            "320000001", region=32, sik_type="paper",
            paper_ballots=PaperBallots(
                total=184, unused_ballots=100, registered_vote=84,  # 100+0+84=184 (paper_control_2 ✓)
                invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                votes=votes, total_valid_votes=84,  # sum=84 (paper_control_3 ✓), 84==0+0+84 (paper_control_4 ✓)
            ),
        )
        assert protocol.sik_no.startswith("32")

    # --- Region 32 skips for paper_machine controls 6 and 9 ---

    def test_control_6_and_9_skipped_for_region_32_paper_machine(self):
        """Controls 6 and 9 are skipped for region 32 paper_machine (no preferences)."""
        # votes=3/2, no_preferences=0 → would fail controls 6,9 if applied (votes != 0+0)
        paper_votes = [PartyVote(party_number=p, votes=3, preferences=[], no_preferences=0) for p in range(1, 29)]
        machine_votes = [PartyVote(party_number=p, votes=2, preferences=[], no_preferences=0) for p in range(1, 29)]
        protocol = _minimal_protocol(
            "320000001", region=32,
            voter_count=200, registered_votes=140,  # 84+56=140 (control_2 ✓), 140≤200 (control_1 ✓)
            paper_ballots=PaperBallots(
                total=184, unused_ballots=100, registered_vote=84,  # 100+0+84=184 (control_3 ✓)
                invalid_out_of_the_box=0, invalid_in_the_box=0, support_noone=0,
                votes=paper_votes, total_valid_votes=84,  # sum=84 (control_4 ✓), 84==0+0+84 (control_5 ✓)
            ),
            machine_ballots=MachineBallots(
                total_votes=56, support_noone=0, total_valid_votes=56,  # 0+56=56 (control_8 ✓), sum=56 (control_7 ✓)
                votes=machine_votes,
            ),
        )
        assert protocol.sik_no.startswith("32")
