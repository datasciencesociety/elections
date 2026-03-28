"""Models for the protocol endpoints."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

REGION_MAX_PREFERENCES: dict[int, int] = {
    1: 22, 2: 28, 3: 32, 4: 16, 5: 8, 6: 12, 7: 8, 8: 10, 9: 10, 10: 8,
    11: 8, 12: 8, 13: 16, 14: 8, 15: 16, 16: 24, 17: 22, 18: 8, 19: 14, 20: 8,
    21: 12, 22: 8, 23: 38, 24: 26, 25: 28, 26: 16, 27: 22, 28: 8, 29: 16, 30: 12,
    31: 8, 32: 0,
}

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/webp",
    "application/pdf",
}


class CandidatePreference(BaseModel):
    """Преференция за конкретен кандидат."""

    candidate_number: int = Field(ge=0)
    count: int = Field(ge=0)


class PartyVote(BaseModel):
    """Глас за партия/коалиция с преференции."""

    party_number: int = Field(ge=0)
    votes: int = Field(ge=0)
    preferences: list[CandidatePreference] = []
    no_preferences: int = Field(default=0, ge=0)


class PaperBallots(BaseModel):
    """Данни за хартиени бюлетини."""

    total: int = Field(ge=0)
    unused_ballots: int = Field(ge=0)
    registered_vote: int = Field(ge=0)
    invalid_out_of_the_box: int = Field(ge=0)
    invalid_in_the_box: int = Field(ge=0)
    support_noone: int = Field(ge=0)
    votes: list[PartyVote] = []
    total_valid_votes: int = Field(ge=0)


class MachineBallots(BaseModel):
    """Данни за машинни бюлетини."""

    total_votes: int = Field(ge=0)
    support_noone: int = Field(ge=0)
    total_valid_votes: int = Field(ge=0)
    votes: list[PartyVote] = []


class Protocol(BaseModel):
    """Протокол от СИК за избори."""

    sik_no: str = Field(pattern=r"^(0[1-9]|[12][0-9]|3[0-2])\d{7}$")
    sik_type: Literal["paper", "paper_machine"]
    voter_count: int = Field(ge=0)
    additional_voter_count: int = Field(ge=0)
    registered_votes: int = Field(ge=0)
    paper_ballots: PaperBallots
    machine_ballots: Optional[MachineBallots] = None

    # --- Structural validators (run before controls) ---

    @model_validator(mode="after")
    def validate_sik_type_sections(self) -> "Protocol":
        if self.sik_type == "paper_machine" and self.machine_ballots is None:
            raise ValueError("machine_ballots is required for sik_type 'paper_machine'")
        if self.sik_type == "paper" and self.machine_ballots is not None:
            raise ValueError("machine_ballots must not be present for sik_type 'paper'")
        return self

    @model_validator(mode="after")
    def validate_party_numbers(self) -> "Protocol":
        region = int(self.sik_no[:2])
        required = set(range(1, 29)) | ({29} if region == 15 else set())
        ballots = [("paper_ballots", self.paper_ballots.votes)]
        if self.machine_ballots is not None:
            ballots.append(("machine_ballots", self.machine_ballots.votes))
        for label, votes in ballots:
            party_numbers = [v.party_number for v in votes]
            duplicates = {n for n in party_numbers if party_numbers.count(n) > 1}
            if duplicates:
                raise ValueError(f"{label} has duplicate party numbers: {sorted(duplicates)}")
            actual = set(party_numbers)
            missing = required - actual
            extra = actual - required
            if missing:
                raise ValueError(f"{label} is missing party numbers: {sorted(missing)}")
            if extra:
                raise ValueError(f"{label} has unexpected party numbers: {sorted(extra)}")
        return self

    @model_validator(mode="after")
    def validate_preferences_count(self) -> "Protocol":
        region = int(self.sik_no[:2])
        if region not in REGION_MAX_PREFERENCES:
            raise ValueError(f"Region {region} is not valid")
        expected = REGION_MAX_PREFERENCES[region]
        all_votes = self.paper_ballots.votes + (self.machine_ballots.votes if self.machine_ballots else [])
        for party_vote in all_votes:
            actual = len(party_vote.preferences)
            party_expected = 0 if (region == 15 and party_vote.party_number == 29) else expected
            if actual != party_expected:
                raise ValueError(
                    f"Party {party_vote.party_number} has {actual} preferences, expected {party_expected} for region {region}"
                )
        return self

    # --- Controls for sik_type 'paper_machine' ---

    @model_validator(mode="after")
    def control_1_registered_votes_le_total_voters(self) -> "Protocol":
        if self.sik_type != "paper_machine":
            return self
        if self.registered_votes > self.voter_count + self.additional_voter_count:
            raise ValueError(
                f"control_1: registered_votes ({self.registered_votes}) must be <= "
                f"voter_count + additional_voter_count ({self.voter_count + self.additional_voter_count})"
            )
        return self

    @model_validator(mode="after")
    def control_2_registered_votes_eq_paper_plus_machine(self) -> "Protocol":
        if self.sik_type != "paper_machine" or self.machine_ballots is None:
            return self
        expected = self.paper_ballots.registered_vote + self.machine_ballots.total_votes
        if self.registered_votes != expected:
            raise ValueError(
                f"control_2: registered_votes ({self.registered_votes}) must equal "
                f"paper_ballots.registered_vote + machine_ballots.total_votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def control_3_paper_total_eq_components(self) -> "Protocol":
        if self.sik_type != "paper_machine":
            return self
        pb = self.paper_ballots
        expected = pb.unused_ballots + pb.invalid_out_of_the_box + pb.registered_vote
        if pb.total != expected:
            raise ValueError(
                f"control_3: paper_ballots.total ({pb.total}) must equal "
                f"unused_ballots + invalid_out_of_the_box + registered_vote ({expected})"
            )
        return self

    @model_validator(mode="after")
    def control_4_paper_total_valid_votes_eq_sum_of_votes(self) -> "Protocol":
        if self.sik_type != "paper_machine":
            return self
        pb = self.paper_ballots
        expected = sum(v.votes for v in pb.votes)
        if pb.total_valid_votes != expected:
            raise ValueError(
                f"control_4: paper_ballots.total_valid_votes ({pb.total_valid_votes}) must equal "
                f"sum of votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def control_5_paper_registered_vote_eq_components(self) -> "Protocol":
        if self.sik_type != "paper_machine":
            return self
        pb = self.paper_ballots
        expected = pb.invalid_in_the_box + pb.support_noone + pb.total_valid_votes
        if pb.registered_vote != expected:
            raise ValueError(
                f"control_5: paper_ballots.registered_vote ({pb.registered_vote}) must equal "
                f"invalid_in_the_box + support_noone + total_valid_votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def control_6_paper_party_votes_eq_preferences_sum(self) -> "Protocol":
        if self.sik_type != "paper_machine":
            return self
        region = int(self.sik_no[:2])
        if REGION_MAX_PREFERENCES.get(region) == 0:
            return self  # no preferences for this region — skip
        for party_vote in self.paper_ballots.votes:
            expected = sum(p.count for p in party_vote.preferences) + party_vote.no_preferences
            if party_vote.votes != expected:
                raise ValueError(
                    f"control_6: paper party {party_vote.party_number} votes ({party_vote.votes}) must equal "
                    f"sum of preferences counts + no_preferences ({expected})"
                )
        return self

    @model_validator(mode="after")
    def control_7_machine_total_valid_votes_eq_sum_of_votes(self) -> "Protocol":
        if self.sik_type != "paper_machine" or self.machine_ballots is None:
            return self
        mb = self.machine_ballots
        expected = sum(v.votes for v in mb.votes)
        if mb.total_valid_votes != expected:
            raise ValueError(
                f"control_7: machine_ballots.total_valid_votes ({mb.total_valid_votes}) must equal "
                f"sum of votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def control_8_machine_total_votes_eq_support_noone_plus_valid(self) -> "Protocol":
        if self.sik_type != "paper_machine" or self.machine_ballots is None:
            return self
        mb = self.machine_ballots
        expected = mb.support_noone + mb.total_valid_votes
        if mb.total_votes != expected:
            raise ValueError(
                f"control_8: machine_ballots.total_votes ({mb.total_votes}) must equal "
                f"support_noone + total_valid_votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def control_9_machine_party_votes_eq_preferences_sum(self) -> "Protocol":
        if self.sik_type != "paper_machine" or self.machine_ballots is None:
            return self
        region = int(self.sik_no[:2])
        if REGION_MAX_PREFERENCES.get(region) == 0:
            return self  # no preferences for this region — skip
        for party_vote in self.machine_ballots.votes:
            expected = sum(p.count for p in party_vote.preferences) + party_vote.no_preferences
            if party_vote.votes != expected:
                raise ValueError(
                    f"control_9: machine party {party_vote.party_number} votes ({party_vote.votes}) must equal "
                    f"sum of preferences counts + no_preferences ({expected})"
                )
        return self

    # --- Controls for sik_type 'paper' ---

    @model_validator(mode="after")
    def paper_control_1_registered_votes_le_total_voters(self) -> "Protocol":
        if self.sik_type != "paper":
            return self
        if self.registered_votes > self.voter_count + self.additional_voter_count:
            raise ValueError(
                f"paper_control_1: registered_votes ({self.registered_votes}) must be <= "
                f"voter_count + additional_voter_count ({self.voter_count + self.additional_voter_count})"
            )
        return self

    @model_validator(mode="after")
    def paper_control_2_paper_total_eq_components(self) -> "Protocol":
        if self.sik_type != "paper":
            return self
        pb = self.paper_ballots
        expected = pb.unused_ballots + pb.invalid_out_of_the_box + pb.registered_vote
        if pb.total != expected:
            raise ValueError(
                f"paper_control_2: paper_ballots.total ({pb.total}) must equal "
                f"unused_ballots + invalid_out_of_the_box + registered_vote ({expected})"
            )
        return self

    @model_validator(mode="after")
    def paper_control_3_paper_total_valid_votes_eq_sum_of_votes(self) -> "Protocol":
        if self.sik_type != "paper":
            return self
        pb = self.paper_ballots
        expected = sum(v.votes for v in pb.votes)
        if pb.total_valid_votes != expected:
            raise ValueError(
                f"paper_control_3: paper_ballots.total_valid_votes ({pb.total_valid_votes}) must equal "
                f"sum of votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def paper_control_4_paper_registered_vote_eq_components(self) -> "Protocol":
        if self.sik_type != "paper":
            return self
        pb = self.paper_ballots
        expected = pb.invalid_in_the_box + pb.support_noone + pb.total_valid_votes
        if pb.registered_vote != expected:
            raise ValueError(
                f"paper_control_4: paper_ballots.registered_vote ({pb.registered_vote}) must equal "
                f"invalid_in_the_box + support_noone + total_valid_votes ({expected})"
            )
        return self

    @model_validator(mode="after")
    def paper_control_5_paper_party_votes_eq_preferences_sum(self) -> "Protocol":
        if self.sik_type != "paper":
            return self
        region = int(self.sik_no[:2])
        if REGION_MAX_PREFERENCES.get(region) == 0:
            return self  # no preferences for this region — skip
        for party_vote in self.paper_ballots.votes:
            expected = sum(p.count for p in party_vote.preferences) + party_vote.no_preferences
            if party_vote.votes != expected:
                raise ValueError(
                    f"paper_control_5: paper party {party_vote.party_number} votes ({party_vote.votes}) must equal "
                    f"sum of preferences counts + no_preferences ({expected})"
                )
        return self
