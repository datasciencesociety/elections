from typing import Literal, Optional
from pydantic import BaseModel, field_validator


class Preference(BaseModel):
    candidate_number: int
    count: int  # how many voted with this preference


class PartyVotes(BaseModel):
    party_number: int
    votes: int
    preferences: list[Preference] = []
    no_preferences: int = 0  # voted for party but no candidate preference


class PaperBallots(BaseModel):
    total: int  # A) total paper ballots received by the section
    unused_ballots: int  # 4.a) unused ballots returned at end of day
    registered_vote: int  # 5) people who actually voted on paper (ballots in the paper box)
    invalid_out_of_the_box: int  # 4.b) e.g. sample ballots pasted on the window at start of day
    invalid_in_the_box: int  # 6) invalid ballots found inside the box
    support_noone: int  # 7) valid ballots with no party marked (blank votes)
    votes: list[PartyVotes]  # 8) votes per party
    total_valid_votes: int  # 9) total valid paper votes

    @field_validator("registered_vote", "invalid_in_the_box", mode="before")
    @classmethod
    def coerce_to_int(cls, v):
        return int(v)


class MachineBallots(BaseModel):
    total_votes: int  # 11) total votes cast on the machine
    support_noone: int  # 12) machine votes for no party (blank)
    total_valid_votes: int  # 14) total valid machine votes
    votes: list[PartyVotes]  # 13) votes per party on the machine


class SIKProtocol(BaseModel):
    sik_no: str  # section number (e.g. "12020009")
    sik_type: Literal["paper", "paper_machine"]
    voter_count: int  # 1) people eligible to vote in this section
    additional_voter_count: int  # 2) people who signed a declaration to vote here from another section
    registered_votes: int  # 3) total people who showed up and voted (paper + machine)
    paper_ballots: PaperBallots
    machine_ballots: Optional[MachineBallots] = None  # only present when sik_type is "paper_machine"
