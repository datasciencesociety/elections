"""Validation Engine — executes validation rules as SQL queries against SQLite."""

import logging
import sqlite3
from dataclasses import dataclass
from typing import Callable

logger = logging.getLogger(__name__)


@dataclass
class Violation:
    """A single validation rule violation."""
    rule_id: str
    section_code: str
    description: str
    expected_value: str
    actual_value: str


SQLITE_SCHEMA = """
CREATE TABLE cik_parties (
    party_number INTEGER PRIMARY KEY,
    party_name TEXT NOT NULL
);

CREATE TABLE local_parties (
    rik_code INTEGER NOT NULL,
    admin_unit_name TEXT NOT NULL,
    party_number INTEGER NOT NULL,
    party_name TEXT NOT NULL,
    PRIMARY KEY (rik_code, party_number)
);

CREATE TABLE local_candidates (
    rik_code INTEGER NOT NULL,
    admin_unit_name TEXT NOT NULL,
    party_number INTEGER NOT NULL,
    party_name TEXT NOT NULL,
    candidate_number INTEGER NOT NULL,
    candidate_name TEXT NOT NULL,
    PRIMARY KEY (rik_code, party_number, candidate_number)
);

CREATE TABLE sections (
    section_code TEXT PRIMARY KEY,
    admin_unit_id INTEGER NOT NULL,
    admin_unit_name TEXT NOT NULL,
    ekatte TEXT NOT NULL,
    settlement_name TEXT NOT NULL,
    address TEXT NOT NULL,
    is_mobile INTEGER NOT NULL,
    is_ship INTEGER NOT NULL,
    num_machines INTEGER NOT NULL
);

CREATE TABLE protocols (
    form_number INTEGER NOT NULL,
    section_code TEXT NOT NULL,
    rik_code INTEGER NOT NULL,
    page_numbers TEXT,
    received_ballots INTEGER,
    voters_in_list INTEGER,
    voters_supplementary INTEGER,
    voters_voted INTEGER,
    unused_ballots INTEGER,
    spoiled_ballots INTEGER,
    ballots_in_box INTEGER,
    invalid_votes INTEGER,
    valid_no_support INTEGER,
    total_valid_party_votes INTEGER,
    machine_ballots_in_box INTEGER,
    machine_no_support INTEGER,
    machine_valid_party_votes INTEGER,
    PRIMARY KEY (section_code)
);

CREATE TABLE votes (
    form_number INTEGER NOT NULL,
    section_code TEXT NOT NULL,
    admin_unit_id INTEGER NOT NULL,
    party_number INTEGER NOT NULL,
    total_votes INTEGER NOT NULL,
    paper_votes INTEGER NOT NULL,
    machine_votes INTEGER NOT NULL,
    PRIMARY KEY (section_code, party_number)
);

CREATE TABLE preferences (
    form_number INTEGER NOT NULL,
    section_code TEXT NOT NULL,
    party_number INTEGER NOT NULL,
    candidate_number TEXT NOT NULL,
    total_votes INTEGER NOT NULL,
    paper_votes INTEGER NOT NULL,
    machine_votes INTEGER NOT NULL
);

CREATE INDEX idx_votes_section ON votes(section_code);
CREATE INDEX idx_votes_party ON votes(party_number);
CREATE INDEX idx_preferences_section ON preferences(section_code);
CREATE INDEX idx_preferences_party ON preferences(party_number);
CREATE INDEX idx_protocols_form ON protocols(form_number);
"""


class ValidationEngine:
    """Executes validation rules as SQL queries against a SQLite database."""

    def __init__(self, db_path: str):
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row

    def _get_rules(self) -> dict[str, Callable]:
        """Return registry mapping rule_id to validation method."""
        return {
            "R2.1": self._rule_r2_1,
            "R2.2": self._rule_r2_2,
            "R2.3": self._rule_r2_3,
            "R2.4": self._rule_r2_4,
            "R2.5": self._rule_r2_5,
            "R2.6": self._rule_r2_6,
            "R3.1": self._rule_r3_1,
            "R3.2": self._rule_r3_2,
            "R3.3": self._rule_r3_3,
            "R3.4": self._rule_r3_4,
            "R3.5": self._rule_r3_5,
            "R4.1": self._rule_r4_1,
            "R4.2": self._rule_r4_2,
            "R4.3": self._rule_r4_3,
            "R5.1": self._rule_r5_1,
            "R5.2": self._rule_r5_2,
            "R5.3": self._rule_r5_3,
            "R5.4": self._rule_r5_4,
            "R5.5": self._rule_r5_5,
            "R5.6": self._rule_r5_6,
            "R6.1": self._rule_r6_1,
            "R6.2": self._rule_r6_2,
            "R6.3": self._rule_r6_3,
            "R6.4": self._rule_r6_4,
            "R7.1": self._rule_r7_1,
            "R7.2": self._rule_r7_2,
            "R7.3": self._rule_r7_3,
            "R7.4": self._rule_r7_4,
            "R7.5": self._rule_r7_5,
        }

    def run_all(self, rules: list[str] | None = None) -> list[Violation]:
        """Run all (or selected) validation rules, collecting violations.

        If *rules* is provided, only those rule_ids are executed.
        Errors during a single rule are logged and execution continues.
        """
        import time

        registry = self._get_rules()

        if rules is not None:
            registry = {rid: fn for rid, fn in registry.items() if rid in rules}

        total = len(registry)
        violations: list[Violation] = []
        for i, (rule_id, rule_fn) in enumerate(registry.items(), 1):
            logger.info("[%d/%d] Изпълнение на правило %s ...", i, total, rule_id)
            try:
                t0 = time.perf_counter()
                result = rule_fn()
                elapsed = time.perf_counter() - t0
                violations.extend(result)
                logger.info("  %s: %d нарушения (%.2f сек)", rule_id, len(result), elapsed)
            except Exception:
                logger.exception("Error executing rule %s", rule_id)

        return violations

    def _rule_r2_1(self) -> list[Violation]:
        """R2.1: received_ballots = unused_ballots + spoiled_ballots + ballots_in_box."""
        sql = """
            SELECT section_code,
                   received_ballots,
                   unused_ballots + spoiled_ballots + ballots_in_box AS expected
            FROM protocols
            WHERE received_ballots != unused_ballots + spoiled_ballots + ballots_in_box
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R2.1",
                section_code=row["section_code"],
                description="Получени бюлетини ≠ неизползвани + сгрешени + намерени в кутията",
                expected_value=str(row["expected"]),
                actual_value=str(row["received_ballots"]),
            ))
        return violations

    def _rule_r2_2(self) -> list[Violation]:
        """R2.2: Paper-only forms: ballots_in_box = invalid_votes + valid_no_support + total_valid_party_votes."""
        sql = """
            SELECT section_code,
                   ballots_in_box,
                   invalid_votes + valid_no_support + total_valid_party_votes AS expected
            FROM protocols
            WHERE form_number IN (24, 28)
              AND ballots_in_box != invalid_votes + valid_no_support + total_valid_party_votes
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R2.2",
                section_code=row["section_code"],
                description="Хартиен формуляр: намерени в кутията ≠ невалидни + \"не подкрепям\" + валидни за партии",
                expected_value=str(row["expected"]),
                actual_value=str(row["ballots_in_box"]),
            ))
        return violations

    def _rule_r2_3(self) -> list[Violation]:
        """R2.3: Machine forms: ballots_in_box = invalid_votes + valid_no_support + total_valid_party_votes (paper part)."""
        sql = """
            SELECT section_code,
                   ballots_in_box,
                   invalid_votes + valid_no_support + total_valid_party_votes AS expected
            FROM protocols
            WHERE form_number IN (26, 30)
              AND ballots_in_box != invalid_votes + valid_no_support + total_valid_party_votes
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R2.3",
                section_code=row["section_code"],
                description="Машинен формуляр: намерени в кутията ≠ невалидни + \"не подкрепям\" хартия + валидни хартия",
                expected_value=str(row["expected"]),
                actual_value=str(row["ballots_in_box"]),
            ))
        return violations

    def _rule_r2_4(self) -> list[Violation]:
        """R2.4: voters_voted <= voters_in_list + voters_supplementary."""
        sql = """
            SELECT section_code,
                   voters_voted,
                   voters_in_list + voters_supplementary AS max_allowed
            FROM protocols
            WHERE voters_voted > voters_in_list + voters_supplementary
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R2.4",
                section_code=row["section_code"],
                description="Гласували повече от вписаните в списъка + допълнителната страница",
                expected_value=f"<= {row['max_allowed']}",
                actual_value=str(row["voters_voted"]),
            ))
        return violations

    def _rule_r2_5(self) -> list[Violation]:
        """R2.5: All numeric fields >= 0."""
        numeric_fields = [
            "received_ballots", "voters_in_list", "voters_supplementary",
            "voters_voted", "unused_ballots", "spoiled_ballots",
            "ballots_in_box", "invalid_votes", "valid_no_support",
            "total_valid_party_votes", "machine_ballots_in_box",
            "machine_no_support", "machine_valid_party_votes",
        ]
        conditions = " OR ".join(f"{f} < 0" for f in numeric_fields)
        sql = f"""
            SELECT section_code, {', '.join(numeric_fields)}
            FROM protocols
            WHERE {conditions}
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            negative_fields = [
                f for f in numeric_fields
                if row[f] is not None and row[f] < 0
            ]
            for field in negative_fields:
                violations.append(Violation(
                    rule_id="R2.5",
                    section_code=row["section_code"],
                    description=f"Отрицателна стойност в поле {field}",
                    expected_value=">= 0",
                    actual_value=str(row[field]),
                ))
        return violations

    def _rule_r2_6(self) -> list[Violation]:
        """R2.6: voters_voted (подписи) = ballots_in_box (+ machine_ballots_in_box for machine forms)."""
        sql = """
            SELECT section_code, form_number, voters_voted,
                   ballots_in_box, machine_ballots_in_box
            FROM protocols
            WHERE CASE
                WHEN form_number IN (26, 30)
                THEN voters_voted != ballots_in_box + COALESCE(machine_ballots_in_box, 0)
                ELSE voters_voted != ballots_in_box
            END
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            if row["form_number"] in (26, 30):
                actual = row["ballots_in_box"] + (row["machine_ballots_in_box"] or 0)
            else:
                actual = row["ballots_in_box"]
            violations.append(Violation(
                rule_id="R2.6",
                section_code=row["section_code"],
                description="Брой гласували (подписи) ≠ намерени бюлетини в кутията",
                expected_value=str(row["voters_voted"]),
                actual_value=str(actual),
            ))
        return violations

    def _rule_r3_1(self) -> list[Violation]:
        """R3.1: Sum of total_votes across parties = total_valid_party_votes in protocol.

        For machine forms (26/30), total_valid_party_votes is paper-only, so we
        compare against total_valid_party_votes + machine_valid_party_votes.
        For paper-only forms (24/28), machine_valid_party_votes is NULL.
        """
        sql = """
            SELECT p.section_code,
                   CASE
                       WHEN p.form_number IN (26, 30)
                       THEN p.total_valid_party_votes + COALESCE(p.machine_valid_party_votes, 0)
                       ELSE p.total_valid_party_votes
                   END AS expected_total,
                   SUM(v.total_votes) AS vote_sum
            FROM protocols p
            JOIN votes v ON p.section_code = v.section_code
            GROUP BY p.section_code
            HAVING expected_total != SUM(v.total_votes)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R3.1",
                section_code=row["section_code"],
                description="Сума гласове по партии ≠ общо валидни в протокола",
                expected_value=str(row["expected_total"]),
                actual_value=str(row["vote_sum"]),
            ))
        return violations

    def _rule_r3_2(self) -> list[Violation]:
        """R3.2: Sum of paper_votes = total_valid_party_votes (machine forms only)."""
        sql = """
            SELECT p.section_code,
                   p.total_valid_party_votes,
                   SUM(v.paper_votes) AS paper_sum
            FROM protocols p
            JOIN votes v ON p.section_code = v.section_code
            WHERE p.form_number IN (26, 30)
            GROUP BY p.section_code
            HAVING p.total_valid_party_votes != SUM(v.paper_votes)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R3.2",
                section_code=row["section_code"],
                description="Сума хартиени гласове ≠ хартиени валидни в протокола (машинен формуляр)",
                expected_value=str(row["total_valid_party_votes"]),
                actual_value=str(row["paper_sum"]),
            ))
        return violations

    def _rule_r3_3(self) -> list[Violation]:
        """R3.3: Sum of machine_votes = machine_valid_party_votes (machine forms only)."""
        sql = """
            SELECT p.section_code,
                   p.machine_valid_party_votes,
                   SUM(v.machine_votes) AS machine_sum
            FROM protocols p
            JOIN votes v ON p.section_code = v.section_code
            WHERE p.form_number IN (26, 30)
            GROUP BY p.section_code
            HAVING p.machine_valid_party_votes != SUM(v.machine_votes)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R3.3",
                section_code=row["section_code"],
                description="Сума машинни гласове ≠ машинни валидни в протокола (машинен формуляр)",
                expected_value=str(row["machine_valid_party_votes"]),
                actual_value=str(row["machine_sum"]),
            ))
        return violations

    def _rule_r3_4(self) -> list[Violation]:
        """R3.4: total_votes = paper_votes + machine_votes for each vote record."""
        sql = """
            SELECT section_code, party_number,
                   total_votes, paper_votes, machine_votes
            FROM votes
            WHERE total_votes != paper_votes + machine_votes
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R3.4",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}: total_votes ≠ paper_votes + machine_votes",
                expected_value=str(row["paper_votes"] + row["machine_votes"]),
                actual_value=str(row["total_votes"]),
            ))
        return violations

    def _rule_r3_5(self) -> list[Violation]:
        """R3.5: machine_votes = 0 for paper-only sections."""
        sql = """
            SELECT v.section_code, v.party_number, v.machine_votes
            FROM votes v
            JOIN protocols p ON v.section_code = p.section_code
            WHERE p.form_number IN (24, 28)
              AND v.machine_votes != 0
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R3.5",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}: machine_votes ≠ 0 в хартиена секция",
                expected_value="0",
                actual_value=str(row["machine_votes"]),
            ))
        return violations

    def _rule_r4_1(self) -> list[Violation]:
        """R4.1: Sum of preference total_votes (including 'Без') = total_votes for party in votes."""
        sql = """
            SELECT v.section_code, v.party_number,
                   v.total_votes AS vote_total,
                   SUM(pr.total_votes) AS pref_sum
            FROM votes v
            JOIN preferences pr ON v.section_code = pr.section_code
                                AND v.party_number = pr.party_number
            GROUP BY v.section_code, v.party_number
            HAVING v.total_votes != SUM(pr.total_votes)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R4.1",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}: сума преференции ≠ гласове за партията",
                expected_value=str(row["vote_total"]),
                actual_value=str(row["pref_sum"]),
            ))
        return violations

    def _rule_r4_2(self) -> list[Violation]:
        """R4.2: Preference total_votes = paper_votes + machine_votes."""
        sql = """
            SELECT section_code, party_number, candidate_number,
                   total_votes, paper_votes, machine_votes
            FROM preferences
            WHERE total_votes != paper_votes + machine_votes
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R4.2",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}, кандидат {row['candidate_number']}: "
                            f"total_votes ≠ paper_votes + machine_votes",
                expected_value=str(row["paper_votes"] + row["machine_votes"]),
                actual_value=str(row["total_votes"]),
            ))
        return violations

    def _rule_r4_3(self) -> list[Violation]:
        """R4.3: Preference machine_votes = 0 for paper-only sections."""
        sql = """
            SELECT pr.section_code, pr.party_number, pr.candidate_number, pr.machine_votes
            FROM preferences pr
            JOIN protocols p ON pr.section_code = p.section_code
            WHERE p.form_number IN (24, 28)
              AND pr.machine_votes != 0
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R4.3",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}, кандидат {row['candidate_number']}: "
                            f"machine_votes ≠ 0 в хартиена секция",
                expected_value="0",
                actual_value=str(row["machine_votes"]),
            ))
        return violations

    def _rule_r5_1(self) -> list[Violation]:
        """R5.1: Protocol section_code exists in sections."""
        sql = """
            SELECT p.section_code
            FROM protocols p
            LEFT JOIN sections s ON p.section_code = s.section_code
            WHERE s.section_code IS NULL
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R5.1",
                section_code=row["section_code"],
                description="Секция от протокол не съществува в списъка със секции",
                expected_value="съществува в sections",
                actual_value="липсва",
            ))
        return violations

    def _rule_r5_2(self) -> list[Violation]:
        """R5.2: Protocol rik_code = first 2 digits of section_code."""
        sql = """
            SELECT section_code, rik_code
            FROM protocols
            WHERE rik_code != CAST(SUBSTR(section_code, 1, 2) AS INTEGER)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R5.2",
                section_code=row["section_code"],
                description="RIK код не съвпада с първите 2 цифри на кода на секцията",
                expected_value=str(row["section_code"][:2]),
                actual_value=str(row["rik_code"]),
            ))
        return violations

    def _rule_r5_3(self) -> list[Violation]:
        """R5.3: Vote party_number exists in cik_parties or local_parties."""
        sql = """
            SELECT v.section_code, v.party_number
            FROM votes v
            LEFT JOIN cik_parties c ON v.party_number = c.party_number
            LEFT JOIN local_parties lp
                ON v.party_number = lp.party_number
                AND CAST(SUBSTR(v.section_code, 1, 2) AS INTEGER) = lp.rik_code
            WHERE c.party_number IS NULL
              AND lp.party_number IS NULL
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R5.3",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']} не съществува в списъка на ЦИК или РИК",
                expected_value="съществува в cik_parties или local_parties",
                actual_value=str(row["party_number"]),
            ))
        return violations

    def _rule_r5_4(self) -> list[Violation]:
        """R5.4: Preference (rik, party, candidate) exists in local_candidates."""
        sql = """
            SELECT pr.section_code, pr.party_number, pr.candidate_number
            FROM preferences pr
            LEFT JOIN local_candidates lc
                ON CAST(SUBSTR(pr.section_code, 1, 2) AS INTEGER) = lc.rik_code
                AND pr.party_number = lc.party_number
                AND CAST(pr.candidate_number AS INTEGER) = lc.candidate_number
            WHERE pr.candidate_number != 'Без'
              AND lc.candidate_number IS NULL
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R5.4",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}, кандидат {row['candidate_number']}: "
                            f"не съществува в local_candidates",
                expected_value="съществува в local_candidates",
                actual_value=f"({row['section_code'][:2]}, {row['party_number']}, {row['candidate_number']})",
            ))
        return violations

    def _rule_r5_5(self) -> list[Violation]:
        """R5.5: form_number ∈ {24, 26, 28, 30}."""
        sql = """
            SELECT section_code, form_number
            FROM protocols
            WHERE form_number NOT IN (24, 26, 28, 30)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R5.5",
                section_code=row["section_code"],
                description="Невалиден номер на формуляр",
                expected_value="{24, 26, 28, 30}",
                actual_value=str(row["form_number"]),
            ))
        return violations

    def _rule_r5_6(self) -> list[Violation]:
        """R5.6: Every section has a protocol (completeness)."""
        sql = """
            SELECT s.section_code
            FROM sections s
            LEFT JOIN protocols p ON s.section_code = p.section_code
            WHERE p.section_code IS NULL
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R5.6",
                section_code=row["section_code"],
                description="Секцията няма протокол",
                expected_value="протокол съществува",
                actual_value="липсва",
            ))
        return violations

    def _rule_r6_1(self) -> list[Violation]:
        """R6.1: machines=0 → paper-only form (24/28)."""
        sql = """
            SELECT p.section_code, p.form_number, s.num_machines
            FROM protocols p
            JOIN sections s ON p.section_code = s.section_code
            WHERE s.num_machines = 0 AND p.form_number NOT IN (24, 28)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R6.1",
                section_code=row["section_code"],
                description=f"Секция без машини трябва да има хартиен формуляр (24/28), но има {row['form_number']}",
                expected_value="24 или 28",
                actual_value=str(row["form_number"]),
            ))
        return violations

    def _rule_r6_2(self) -> list[Violation]:
        """R6.2: machines>0 → machine form (26/30)."""
        sql = """
            SELECT p.section_code, p.form_number, s.num_machines
            FROM protocols p
            JOIN sections s ON p.section_code = s.section_code
            WHERE s.num_machines > 0 AND p.form_number NOT IN (26, 30)
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R6.2",
                section_code=row["section_code"],
                description=f"Секция с {row['num_machines']} машини трябва да има машинен формуляр (26/30), но има {row['form_number']}",
                expected_value="26 или 30",
                actual_value=str(row["form_number"]),
            ))
        return violations

    def _rule_r6_3(self) -> list[Violation]:
        """R6.3: form 28/30 → section abroad (RIK code 32)."""
        sql = """
            SELECT p.section_code, p.form_number
            FROM protocols p
            WHERE p.form_number IN (28, 30)
              AND CAST(SUBSTR(p.section_code, 1, 2) AS INTEGER) != 32
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R6.3",
                section_code=row["section_code"],
                description=f"Формуляр {row['form_number']} е за секции в чужбина, но секцията не е в район 32",
                expected_value="РИК код 32 (чужбина)",
                actual_value=f"РИК код {row['section_code'][:2]}",
            ))
        return violations

    def _rule_r6_4(self) -> list[Violation]:
        """R6.4: form_number in protocol = form_number in votes."""
        sql = """
            SELECT p.section_code, p.form_number AS protocol_form, v.form_number AS vote_form
            FROM protocols p
            JOIN votes v ON p.section_code = v.section_code
            WHERE p.form_number != v.form_number
            GROUP BY p.section_code
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R6.4",
                section_code=row["section_code"],
                description="Номер на формуляр в протокола не съвпада с номера в гласовете",
                expected_value=str(row["protocol_form"]),
                actual_value=str(row["vote_form"]),
            ))
        return violations

    def _rule_r7_1(self) -> list[Violation]:
        """R7.1: 0 < received_ballots ≤ 1500."""
        sql = """
            SELECT section_code, received_ballots
            FROM protocols
            WHERE received_ballots <= 0 OR received_ballots > 1500
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R7.1",
                section_code=row["section_code"],
                description="Получени бюлетини извън допустимия диапазон (0, 1500]",
                expected_value="0 < received_ballots ≤ 1500",
                actual_value=str(row["received_ballots"]),
            ))
        return violations

    def _rule_r7_2(self) -> list[Violation]:
        """R7.2: For paper-only: voters_voted ≤ received_ballots.
        For machine forms: ballots_in_box ≤ received_ballots (compare only paper part).
        """
        sql = """
            SELECT section_code, form_number, voters_voted,
                   ballots_in_box, received_ballots
            FROM protocols
            WHERE CASE
                WHEN form_number IN (26, 30)
                THEN ballots_in_box > received_ballots
                ELSE voters_voted > received_ballots
            END
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            if row["form_number"] in (26, 30):
                violations.append(Violation(
                    rule_id="R7.2",
                    section_code=row["section_code"],
                    description="Намерени хартиени бюлетини повече от получените",
                    expected_value=f"≤ {row['received_ballots']}",
                    actual_value=str(row["ballots_in_box"]),
                ))
            else:
                violations.append(Violation(
                    rule_id="R7.2",
                    section_code=row["section_code"],
                    description="Гласували повече от получените бюлетини",
                    expected_value=f"≤ {row['received_ballots']}",
                    actual_value=str(row["voters_voted"]),
                ))
        return violations

    def _rule_r7_3(self) -> list[Violation]:
        """R7.3: ballots_in_box ≤ voters_voted."""
        sql = """
            SELECT section_code, ballots_in_box, voters_voted
            FROM protocols
            WHERE ballots_in_box > voters_voted
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R7.3",
                section_code=row["section_code"],
                description="Бюлетини в кутията повече от гласувалите",
                expected_value=f"≤ {row['voters_voted']}",
                actual_value=str(row["ballots_in_box"]),
            ))
        return violations

    def _rule_r7_4(self) -> list[Violation]:
        """R7.4: Party votes ≤ voters_voted."""
        sql = """
            SELECT v.section_code, v.party_number, v.total_votes, p.voters_voted
            FROM votes v
            JOIN protocols p ON v.section_code = p.section_code
            WHERE v.total_votes > p.voters_voted
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R7.4",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}: гласове за партията надвишават гласувалите",
                expected_value=f"≤ {row['voters_voted']}",
                actual_value=str(row["total_votes"]),
            ))
        return violations

    def _rule_r7_5(self) -> list[Violation]:
        """R7.5: Candidate preferences ≤ party votes (excluding 'Без')."""
        sql = """
            SELECT pr.section_code, pr.party_number, pr.candidate_number,
                   pr.total_votes, v.total_votes AS party_votes
            FROM preferences pr
            JOIN votes v ON pr.section_code = v.section_code
                        AND pr.party_number = v.party_number
            WHERE pr.candidate_number != 'Без'
              AND pr.total_votes > v.total_votes
        """
        violations: list[Violation] = []
        for row in self.conn.execute(sql):
            violations.append(Violation(
                rule_id="R7.5",
                section_code=row["section_code"],
                description=f"Партия {row['party_number']}, кандидат {row['candidate_number']}: "
                            f"преференции надвишават гласовете за партията",
                expected_value=f"≤ {row['party_votes']}",
                actual_value=str(row["total_votes"]),
            ))
        return violations
