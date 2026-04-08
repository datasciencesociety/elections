"""
Protocol validator for elections with REAL stride-4 votes AND 7-field preferences.

Elections using this validator:
  - ns2023         (02.04.2023, Народно събрание)
  - europe2024_ns  (09.06.2024, Народно събрание)
  - europe2024_ep  (09.06.2024, Европейски парламент)
  - pe202410       (27.10.2024, Народно събрание)
  - pe202410_ks    (27.10.2024, Народно събрание — конституционен съд)

CIK data format (from ns2023 readme onward):
  Form numbers: 24 (Х), 26 (ХМ), 28 (ЧХ), 30 (ЧХМ)
  votes.txt:    stride 4 — party;total;paper;machine (REAL split from CIK)
  preferences:  7 fields — form;section;party;candidate;total;paper;machine

  pe202410_ks has stride 5 in votes.txt (extra KS court column) but the parser
  normalizes it to the same schema — no special handling needed here.

  ns2023 was the first election to drop machine-only forms (25, 27, 29, 31, 32, 41)
  and embed paper/machine split directly in votes.txt and preferences.txt.

Known CIK data quality issue:
  Some sections (~200-450 per election) have preferences where machine=0 for ALL
  candidates despite votes having machine>0. In these sections:
    - preferences.total = preferences.paper (both contain the same value)
    - The value is NOT the paper preference count — it doesn't match vote.paper either
    - The preference data is corrupted/unreliable for these sections

  When detected (machine prefs = 0, total paper prefs ≠ total paper votes),
  R4.1 and R7.5 are SKIPPED for the section to avoid false positives.
  When paper prefs DO match paper votes, we check against paper votes only.

Rules applied:
  R3.1  SUM(party votes) ≠ total valid
  R3.2  Paper + machine votes ≠ total valid (form 26/30 sections)
  R4.1  SUM(preferences) ≠ party votes (with machine gap handling)
  R7.1  Received ballots outside (0, 1500]
  R7.4  Party votes > actual voters
  R7.5  Single preference > party votes (with machine gap handling)
"""

from .common import load_protocols, load_votes, load_preferences, save_violations


def validate(conn, election_id):
    cur = conn.cursor()
    violations = []

    protos = load_protocols(cur, election_id)
    votes_by_section = load_votes(cur, election_id)
    pref_sums, has_prefs = load_preferences(cur, election_id)

    # Pre-compute which sections have unreliable preference data.
    # A section is unreliable when:
    #   1. It has machine votes but zero machine preferences (CIK data gap)
    #   2. The paper preference sum doesn't match paper vote sum either (corrupted data)
    unreliable_pref_sections = set()
    # Also track which sections just have missing machine prefs but paper is OK
    missing_machine_sections = set()

    if has_prefs:
        for sc in pref_sums:
            section_votes = votes_by_section.get(sc, [])
            has_machine_votes = any(v['machine'] > 0 for v in section_votes)
            has_machine_prefs = any(p['machine'] > 0 for p in pref_sums[sc].values())

            if has_machine_votes and not has_machine_prefs:
                total_paper_prefs = sum(p['paper'] for p in pref_sums[sc].values())
                total_paper_votes = sum(v['paper'] for v in section_votes)
                if total_paper_prefs != total_paper_votes:
                    unreliable_pref_sections.add(sc)
                else:
                    missing_machine_sections.add(sc)

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

        # R3.2: paper + machine ≠ total valid (form 26 = ХМ, form 30 = ЧХМ)
        is_machine_form = proto.get('form_num') in (26, 30)
        if is_machine_form and votes:
            paper_sum = sum(v['paper'] for v in votes)
            machine_sum = sum(v['machine'] for v in votes)
            if paper_sum > 0 and machine_sum > 0:
                combined = paper_sum + machine_sum
                if combined != expected_valid and expected_valid > 0:
                    violations.append((election_id, sc, 'R3.2',
                        'Сума хартиени + машинни гласове ≠ общо валидни (машинен формуляр)',
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
        if has_prefs and sc in pref_sums:
            if sc in unreliable_pref_sections:
                pass  # Skip — corrupted CIK preference data
            else:
                use_paper = sc in missing_machine_sections
                party_vote_map = {v['party']: v for v in votes}

                for party_num, pref in pref_sums[sc].items():
                    vote = party_vote_map.get(party_num)
                    if use_paper:
                        compare_votes = vote['paper'] if vote else 0
                        compare_prefs = pref['paper']
                        suffix = ' (само хартия — машинни преференции липсват в данните)'
                    else:
                        compare_votes = vote['total'] if vote else 0
                        compare_prefs = pref['total']
                        suffix = ''

                    if compare_prefs != compare_votes:
                        violations.append((election_id, sc, 'R4.1',
                            f"Партия {party_num}: сума преференции ≠ гласове за партията{suffix}",
                            str(compare_votes), str(compare_prefs),
                            'error' if abs(compare_prefs - compare_votes) > 5 else 'warning'))

    # R7.5: per-candidate preference > party votes
    if has_prefs:
        for sc, party, cand, total, paper, machine in cur.execute("""
            SELECT section_code, party_number, candidate_number, total, paper, machine
            FROM preferences WHERE election_id = ?
        """, (election_id,)):
            total = total or 0
            if total == 0 or sc in unreliable_pref_sections:
                continue

            vote = None
            for v in votes_by_section.get(sc, []):
                if v['party'] == party:
                    vote = v
                    break

            if sc in missing_machine_sections:
                compare_pref = paper or 0
                compare_votes = vote['paper'] if vote else 0
            else:
                compare_pref = total
                compare_votes = vote['total'] if vote else 0

            if compare_pref > compare_votes and compare_votes >= 0:
                violations.append((election_id, sc, 'R7.5',
                    f"Партия {party}, кандидат {cand}: преференции надвишават гласовете за партията",
                    f"≤ {compare_votes}", str(compare_pref), 'error'))

    return save_violations(conn, cur, election_id, violations)
