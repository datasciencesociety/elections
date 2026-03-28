"""Business logic for protocol operations."""

from fastapi import UploadFile

from election_protocols_be.models.protocol import (
    MachineBallots,
    PaperBallots,
    Protocol,
)


async def check(files: list[UploadFile]) -> Protocol:
    return Protocol(
        sik_no="12020009",
        sik_type="paper",
        voter_count=427,
        additional_voter_count=3,
        registered_votes=160,
        paper_ballots=PaperBallots(
            total=300,
            unused_ballots=217,
            registered_vote=82,
            invalid_out_of_the_box=1,
            invalid_in_the_box=1,
            support_noone=0,
            total_valid_votes=81,
        ),
        machine_ballots=MachineBallots(
            total_votes=78,
            support_noone=2,
            total_valid_votes=76,
        ),
    )
