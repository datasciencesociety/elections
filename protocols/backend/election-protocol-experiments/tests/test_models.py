from models import SIKProtocol


def test_parse_sik_protocol():
    data = {
        "sik_no": "12020009",
        "sik_type": "paper_machine",
        "voter_count": 427,
        "additional_voter_count": 3,
        "registered_votes": 160,
        "paper_ballots": {
            "total": 300,
            "unused_ballots": 217,
            "registered_vote": "82",       # string — coerced to int by validator
            "invalid_out_of_the_box": 1,
            "invalid_in_the_box": "1",     # string — coerced to int by validator
            "support_noone": 0,
            "votes": [
                {
                    "party_number": 8,
                    "votes": 6,
                    "preferences": [
                        {"candidate_number": 102, "count": 3}
                    ],
                    "no_preferences": 1,
                }
            ],
            "total_valid_votes": 81,
        },
        "machine_ballots": {
            "total_votes": 78,
            "support_noone": 2,
            "total_valid_votes": 76,
            "votes": [
                {
                    "party_number": 1,
                    "votes": 6,
                    "preferences": [
                        {"candidate_number": 101, "count": 3}
                    ],
                    "no_preferences": 3,
                }
            ],
        },
    }

    protocol = SIKProtocol(**data)

    assert protocol.sik_no == "12020009"
    assert protocol.sik_type == "paper_machine"
    assert protocol.voter_count == 427
    assert protocol.additional_voter_count == 3
    assert protocol.registered_votes == 160

    pb = protocol.paper_ballots
    assert pb.total == 300
    assert pb.unused_ballots == 217
    assert pb.registered_vote == 82        # was "82" string
    assert pb.invalid_out_of_the_box == 1
    assert pb.invalid_in_the_box == 1     # was "1" string
    assert pb.support_noone == 0
    assert pb.total_valid_votes == 81
    assert len(pb.votes) == 1
    party = pb.votes[0]
    assert party.party_number == 8
    assert party.votes == 6
    assert party.no_preferences == 1
    assert party.preferences[0].candidate_number == 102
    assert party.preferences[0].count == 3

    mb = protocol.machine_ballots
    assert mb is not None
    assert mb.total_votes == 78
    assert mb.support_noone == 2
    assert mb.total_valid_votes == 76
    assert len(mb.votes) == 1
    machine_party = mb.votes[0]
    assert machine_party.party_number == 1
    assert machine_party.votes == 6
    assert machine_party.no_preferences == 3
    assert machine_party.preferences[0].candidate_number == 101
    assert machine_party.preferences[0].count == 3
