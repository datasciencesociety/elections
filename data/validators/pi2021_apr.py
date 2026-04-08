"""
Protocol validator for pi2021_apr (04.04.2021, Народно събрание).

This election uses the OLD CIK format, unique to this one election.

CIK data format (from readme_04.04.2021.txt):
  Form numbers: 1 (paper domestic), 7 (paper abroad), 8 (paper+machine mixed), 14 (machine data)
  votes.txt:     stride 4 — party;total;paper;machine (REAL split from CIK)
  preferences:   6 fields — section;party;candidate;total;paper;machine (NO form number prefix)
  Separate files: votes_mv.txt and preferences_mv.txt for machine voting device data

  Form 8 protocol fields:
    4a) бюлетини в кутията от хартиено гласуване
    4b) бюлетини в кутията от машинно гласуване
    6a) действителни гласове от хартиени бюлетини
    6b) действителни гласове от машинно гласуване

Rules applied:
  R3.1  SUM(party votes) ≠ total valid
  R3.2  Paper + machine votes ≠ total valid (form 8 sections only)
  R4.1  SUM(preferences) ≠ party votes
  R7.1  Received ballots outside (0, 1500]
  R7.4  Party votes > actual voters
  R7.5  Single preference > party votes
"""

from .common import load_protocols, load_votes, load_preferences, save_violations


def validate(conn, election_id):
    cur = conn.cursor()
    violations = []

    protos = load_protocols(cur, election_id)
    votes_by_section = load_votes(cur, election_id)
    pref_sums, has_prefs = load_preferences(cur, election_id)

    for sc, proto in protos.items():
        votes = votes_by_section.get(sc, [])
        actual = proto['actual']
        expected_valid = actual - proto['invalid'] - proto['null']

        # R3.1: SUM(party votes) ≠ total valid
        vote_sum = sum(v['total'] for v in votes)
        if vote_sum != expected_valid and expected_valid > 0:
            violations.append((election_id, sc, 'R3.1',
                'Сума гласове по партии ≠ общо валидни в протокола',
                str(expected_valid), str(vote_sum),
                'error' if abs(vote_sum - expected_valid) > 5 else 'warning'))

        # R3.2: paper + machine ≠ total valid (form 8 = mixed paper+machine)
        is_mixed_form = proto.get('form_num') == 8
        if is_mixed_form and votes:
            paper_sum = sum(v['paper'] for v in votes)
            machine_sum = sum(v['machine'] for v in votes)
            if paper_sum > 0 and machine_sum > 0:
                combined = paper_sum + machine_sum
                if combined != expected_valid and expected_valid > 0:
                    violations.append((election_id, sc, 'R3.2',
                        'Сума хартиени + машинни гласове ≠ общо валидни (формуляр 8)',
                        str(expected_valid), str(combined), 'warning'))

        # R7.1: received ballots outside (0, 1500]
        received = proto['received']
        if received > 1500:
            violations.append((election_id, sc, 'R7.1',
                'Получени бюлетини извън допустимия диапазон (0, 1500]',
                '0 < received_ballots ≤ 1500', str(received), 'error'))
        elif received <= 0 and actual > 0:
            violations.append((election_id, sc, 'R7.1',
                'Получени бюлетини извън допустимия диапазон (0, 1500]',
                '0 < received_ballots ≤ 1500', str(received), 'warning'))

        # R7.4: party votes > actual voters
        for v in votes:
            if v['total'] > actual and actual > 0:
                violations.append((election_id, sc, 'R7.4',
                    f"Партия {v['party']}: гласове за партията надвишават гласувалите",
                    f"≤ {actual}", str(v['total']), 'error'))

        # R4.1: SUM(preferences) ≠ party votes
        # This election has REAL paper/machine split in preferences (6-field format)
        if has_prefs and sc in pref_sums:
            party_vote_map = {v['party']: v['total'] for v in votes}
            for party_num, pref in pref_sums[sc].items():
                party_votes = party_vote_map.get(party_num, 0)
                if pref['total'] != party_votes:
                    violations.append((election_id, sc, 'R4.1',
                        f"Партия {party_num}: сума преференции ≠ гласове за партията",
                        str(party_votes), str(pref['total']),
                        'error' if abs(pref['total'] - party_votes) > 5 else 'warning'))

    # R7.5: per-candidate preference > party votes
    if has_prefs:
        for sc, party, cand, total in cur.execute("""
            SELECT section_code, party_number, candidate_number, total
            FROM preferences WHERE election_id = ?
        """, (election_id,)):
            total = total or 0
            if total == 0:
                continue
            party_votes = 0
            for v in votes_by_section.get(sc, []):
                if v['party'] == party:
                    party_votes = v['total']
                    break
            if total > party_votes and party_votes >= 0:
                violations.append((election_id, sc, 'R7.5',
                    f"Партия {party}, кандидат {cand}: преференции надвишават гласовете за партията",
                    f"≤ {party_votes}", str(total), 'error'))

    return save_violations(conn, cur, election_id, violations)
