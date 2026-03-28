"""Models for the protocol endpoints."""

from pydantic import BaseModel

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/webp",
    "application/pdf",
}


class CandidatePreference(BaseModel):
    """Преференция за конкретен кандидат."""

    candidate_number: int
    count: int


class PartyVote(BaseModel):
    """Глас за партия/коалиция с преференции."""

    party_number: int
    votes: int
    preferences: list[CandidatePreference] = []
    no_preferences: int = 0


class PaperBallots(BaseModel):
    """Данни за хартиени бюлетини."""

    total: int
    unused_ballots: int
    registered_vote: int
    invalid_out_of_the_box: int
    invalid_in_the_box: int
    support_noone: int
    votes: list[PartyVote] = []
    total_valid_votes: int


class MachineBallots(BaseModel):
    """Данни за машинни бюлетини."""

    total_votes: int
    support_noone: int
    total_valid_votes: int
    votes: list[PartyVote] = []


class Protocol(BaseModel):
    """Протокол от СИК за избори."""

    sik_no: str
    sik_type: str
    voter_count: int
    additional_voter_count: int
    registered_votes: int
    paper_ballots: PaperBallots
    machine_ballots: MachineBallots
