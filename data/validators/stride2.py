"""
Protocol validator for elections with stride-2 votes (total only, no paper/machine split).

Elections using this validator:
  - pi2021_jul   (11.07.2021, Народно събрание)
  - pvrns2021_ns (14.11.2021, Народно събрание)
  - pvrns2021_pvr_r1 (14.11.2021, Президент тур 1)
  - pvrns2021_pvr_r2 (21.11.2021, Президент тур 2)
  - ns2022       (02.10.2022, Народно събрание)

CIK data format (from readmes):
  Form numbers: 24 (Х), 25 (М), 26 (ХМ), 27 (КР), 28 (ЧХ), 29 (ЧМ), 31 (ЧКР), 32, 41
  votes.txt:    stride 2 — party_number;total (NO paper/machine split)
  preferences:  5 fields — form;section;party;candidate;total (NO paper/machine)

  The parser INFERS paper/machine from form_num:
    form 24/28 → paper=total, machine=0
    form 32/41 → paper=0, machine=total
    form 26/30 → paper=total, machine=0 (misleading — this is the combined total)
  This inferred split is NOT reliable for arithmetic checks.

  Presidential elections (pvrns2021_pvr_r1, pvrns2021_pvr_r2) have no preferences.

Rules applied:
  R3.1  SUM(party votes) ≠ total valid votes
  R4.1  SUM(preferences) ≠ party votes (when preferences exist)
  R7.1  Received ballots outside (0, 1500]
  R7.4  Party votes > actual voters
  R7.5  Single preference > party votes (when preferences exist)

Rules NOT applied:
  R3.2/R3.3 — paper/machine split is parser-inferred, not from CIK data.
              Checking it would produce false positives for form 26/30 sections
              where paper=total (includes machine votes too).
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
        # Only total comparison — no paper/machine split available in preferences
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
