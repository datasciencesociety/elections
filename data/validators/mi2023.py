"""
Protocol validator for mi2023 local elections (29.10.2023 / 05.11.2023).

Elections using this validator:
  - mi2023_council            (общински съветници, тур 1)
  - mi2023_mayor_r1           (кмет община, тур 1)
  - mi2023_mayor_r2           (кмет община, тур 2)
  - mi2023_kmetstvo_r1        (кмет кметство, тур 1)
  - mi2023_kmetstvo_r2        (кмет кметство, тур 2)
  - mi2023_neighbourhood_r1   (кмет район, тур 1)
  - mi2023_neighbourhood_r2   (кмет район, тур 2)

CIK data format (from readme_29.10.2023.txt):
  Form numbers: 24 (Х), 26 (ХМ) — no abroad forms (local elections)
  votes.txt:    stride 4 — party;total;paper;machine (REAL split from CIK)
  preferences:  NOT available for local elections

  Form 26 (ХМ) protocol:
    Position 15: бюлетини в кутията (хартиени)
    Position 16: недействителни гласове (хартиени бюлетини)
    Position 17: „Не подкрепям никого" от хартиени бюлетини
    Position 19: бюлетини в кутията от машинно гласуване
    Position 20: „Не подкрепям никого" от машинно гласуване
    Position 21: общ брой действителни гласове от машинно гласуване

  sections.txt extra fields:
    Field 1.a: списък част I
    Field 1.b: списък част II

Rules applied:
  R3.1  SUM(party votes) ≠ total valid
  R3.2  Paper + machine votes ≠ total valid (form 26 sections)
  R7.1  Received ballots outside (0, 1500]
  R7.4  Party votes > actual voters

Rules NOT applied:
  R4.1, R7.5 — no preference data for local elections
"""

from .common import load_protocols, load_votes, save_violations


def validate(conn, election_id):
    cur = conn.cursor()
    violations = []

    protos = load_protocols(cur, election_id)
    votes_by_section = load_votes(cur, election_id)

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

        # R3.2: paper + machine ≠ total valid (form 26 = ХМ combined)
        is_machine_form = proto.get('form_num') == 26
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

    return save_violations(conn, cur, election_id, violations)
