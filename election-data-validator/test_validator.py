"""Unit tests for ValidationEngine."""

import logging
import sqlite3
import tempfile
import os

import pytest

from validator import ValidationEngine, Violation, SQLITE_SCHEMA


@pytest.fixture
def db_path(tmp_path):
    """Create a temporary SQLite database with the election schema."""
    path = str(tmp_path / "test.db")
    conn = sqlite3.connect(path)
    conn.executescript(SQLITE_SCHEMA)
    conn.close()
    return path


class TestValidationEngineInit:
    def test_connects_to_database(self, db_path):
        engine = ValidationEngine(db_path)
        # Should be able to execute a query
        cur = engine.conn.execute("SELECT 1")
        assert cur.fetchone()[0] == 1

    def test_row_factory_set(self, db_path):
        engine = ValidationEngine(db_path)
        assert engine.conn.row_factory == sqlite3.Row


class TestGetRules:
    def test_returns_dict(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        assert isinstance(rules, dict)

    def test_contains_r2_rules(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        for rid in ("R2.1", "R2.2", "R2.3", "R2.4", "R2.5"):
            assert rid in rules, f"{rid} missing from rule registry"


class TestRunAll:
    def test_returns_empty_list_no_rules(self, db_path):
        engine = ValidationEngine(db_path)
        assert engine.run_all() == []

    def test_collects_violations_from_rules(self, db_path):
        engine = ValidationEngine(db_path)
        v1 = Violation("R1.1", "010100001", "desc1", "10", "5")
        v2 = Violation("R1.2", "010100002", "desc2", "20", "15")

        engine._get_rules = lambda: {
            "R1.1": lambda: [v1],
            "R1.2": lambda: [v2],
        }

        result = engine.run_all()
        assert result == [v1, v2]

    def test_filters_by_selected_rules(self, db_path):
        engine = ValidationEngine(db_path)
        v1 = Violation("R1.1", "010100001", "desc1", "10", "5")
        v2 = Violation("R1.2", "010100002", "desc2", "20", "15")

        engine._get_rules = lambda: {
            "R1.1": lambda: [v1],
            "R1.2": lambda: [v2],
        }

        result = engine.run_all(rules=["R1.1"])
        assert result == [v1]

    def test_filters_with_nonexistent_rule(self, db_path):
        engine = ValidationEngine(db_path)
        v1 = Violation("R1.1", "010100001", "desc1", "10", "5")

        engine._get_rules = lambda: {
            "R1.1": lambda: [v1],
        }

        result = engine.run_all(rules=["R99.99"])
        assert result == []

    def test_error_in_rule_logs_and_continues(self, db_path, caplog):
        engine = ValidationEngine(db_path)
        v_ok = Violation("R1.2", "010100002", "desc", "10", "5")

        def failing_rule():
            raise RuntimeError("SQL error")

        engine._get_rules = lambda: {
            "R1.1": failing_rule,
            "R1.2": lambda: [v_ok],
        }

        with caplog.at_level(logging.ERROR):
            result = engine.run_all()

        assert result == [v_ok]
        assert "Error executing rule R1.1" in caplog.text

    def test_multiple_violations_from_single_rule(self, db_path):
        engine = ValidationEngine(db_path)
        violations = [
            Violation("R1.1", f"01010000{i}", f"desc{i}", "10", "5")
            for i in range(5)
        ]

        engine._get_rules = lambda: {"R1.1": lambda: violations}

        result = engine.run_all()
        assert len(result) == 5
        assert result == violations

    def test_run_all_with_empty_rules_list(self, db_path):
        engine = ValidationEngine(db_path)
        v1 = Violation("R1.1", "010100001", "desc1", "10", "5")

        engine._get_rules = lambda: {"R1.1": lambda: [v1]}

        result = engine.run_all(rules=[])
        assert result == []


# --- Helper to insert protocol rows ---

def _insert_protocol(conn, section_code="010100001", form_number=24, **overrides):
    """Insert a protocol row with sensible defaults, overridden by kwargs."""
    defaults = dict(
        form_number=form_number,
        section_code=section_code,
        rik_code=1,
        page_numbers="",
        received_ballots=100,
        voters_in_list=200,
        voters_supplementary=10,
        voters_voted=90,
        unused_ballots=5,
        spoiled_ballots=5,
        ballots_in_box=90,
        invalid_votes=10,
        valid_no_support=5,
        total_valid_party_votes=75,
        machine_ballots_in_box=None,
        machine_no_support=None,
        machine_valid_party_votes=None,
    )
    defaults.update(overrides)
    cols = ", ".join(defaults.keys())
    placeholders = ", ".join("?" for _ in defaults)
    conn.execute(f"INSERT INTO protocols ({cols}) VALUES ({placeholders})", list(defaults.values()))
    conn.commit()


# --- R2.1 Tests ---

class TestRuleR2_1:
    """R2.1: received_ballots = unused_ballots + spoiled_ballots + ballots_in_box."""

    def test_no_violation_when_balanced(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=100, unused_ballots=5, spoiled_ballots=5, ballots_in_box=90)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_1() == []

    def test_violation_when_unbalanced(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=100, unused_ballots=5, spoiled_ballots=5, ballots_in_box=80)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_1()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R2.1"
        assert v.section_code == "010100001"
        assert v.expected_value == "90"
        assert v.actual_value == "100"

    def test_multiple_violations(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", received_ballots=50, unused_ballots=10, spoiled_ballots=10, ballots_in_box=10)
        _insert_protocol(conn, section_code="010100002", received_ballots=200, unused_ballots=50, spoiled_ballots=50, ballots_in_box=50)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_1()
        assert len(violations) == 2


# --- R2.2 Tests ---

class TestRuleR2_2:
    """R2.2: Paper-only: ballots_in_box = invalid_votes + valid_no_support + total_valid_party_votes."""

    def test_no_violation_paper_form_balanced(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, form_number=24, ballots_in_box=90, invalid_votes=10, valid_no_support=5, total_valid_party_votes=75)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_2() == []

    def test_violation_paper_form_unbalanced(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, form_number=28, ballots_in_box=90, invalid_votes=10, valid_no_support=5, total_valid_party_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_2()
        assert len(violations) == 1
        assert violations[0].rule_id == "R2.2"
        assert violations[0].expected_value == "65"
        assert violations[0].actual_value == "90"

    def test_ignores_machine_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        # Machine form with unbalanced values — should NOT trigger R2.2
        _insert_protocol(conn, form_number=26, ballots_in_box=90, invalid_votes=10, valid_no_support=5, total_valid_party_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_2() == []


# --- R2.3 Tests ---

class TestRuleR2_3:
    """R2.3: Machine forms: ballots_in_box = invalid_votes + valid_no_support + total_valid_party_votes (paper part)."""

    def test_no_violation_machine_form_balanced(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, form_number=26, ballots_in_box=90, invalid_votes=10, valid_no_support=5, total_valid_party_votes=75)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_3() == []

    def test_violation_machine_form_unbalanced(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, form_number=30, ballots_in_box=90, invalid_votes=10, valid_no_support=5, total_valid_party_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_3()
        assert len(violations) == 1
        assert violations[0].rule_id == "R2.3"

    def test_ignores_paper_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, form_number=24, ballots_in_box=90, invalid_votes=10, valid_no_support=5, total_valid_party_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_3() == []


# --- R2.4 Tests ---

class TestRuleR2_4:
    """R2.4: voters_voted <= voters_in_list + voters_supplementary."""

    def test_no_violation_when_within_limit(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=90, voters_in_list=200, voters_supplementary=10)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_4() == []

    def test_no_violation_when_equal(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=210, voters_in_list=200, voters_supplementary=10)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_4() == []

    def test_violation_when_exceeds(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=211, voters_in_list=200, voters_supplementary=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_4()
        assert len(violations) == 1
        assert violations[0].rule_id == "R2.4"
        assert violations[0].expected_value == "<= 210"
        assert violations[0].actual_value == "211"


# --- R2.5 Tests ---

class TestRuleR2_5:
    """R2.5: All numeric fields >= 0."""

    def test_no_violation_all_positive(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_5() == []

    def test_violation_negative_received_ballots(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=-1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_5()
        assert len(violations) == 1
        assert violations[0].rule_id == "R2.5"
        assert "received_ballots" in violations[0].description
        assert violations[0].actual_value == "-1"

    def test_violation_multiple_negative_fields(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=-1, voters_voted=-5, spoiled_ballots=-3)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r2_5()
        assert len(violations) == 3
        fields = {v.description.split("поле ")[1] for v in violations}
        assert fields == {"received_ballots", "voters_voted", "spoiled_ballots"}

    def test_null_machine_fields_ignored(self, db_path):
        """NULL machine fields (paper-only forms) should not trigger violations."""
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, form_number=24,
                         machine_ballots_in_box=None,
                         machine_no_support=None,
                         machine_valid_party_votes=None)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_5() == []

    def test_zero_values_no_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=0, unused_ballots=0, spoiled_ballots=0,
                         ballots_in_box=0, invalid_votes=0, valid_no_support=0,
                         total_valid_party_votes=0, voters_in_list=0,
                         voters_supplementary=0, voters_voted=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r2_5() == []


# --- Integration: run_all with R2 rules ---

class TestRunAllR2Rules:
    """Test that R2 rules are properly registered and run via run_all()."""

    def test_run_all_finds_r2_violations(self, db_path):
        conn = sqlite3.connect(db_path)
        # Unbalanced R2.1 row
        _insert_protocol(conn, received_ballots=999, unused_ballots=1, spoiled_ballots=1, ballots_in_box=1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R2.1"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R2.1"

    def test_run_all_filters_r2_rules(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=999, unused_ballots=1, spoiled_ballots=1, ballots_in_box=1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R2.2"])
        # R2.2 checks paper-only form balance, not R2.1 balance — default form is 24
        # ballots_in_box=1, invalid=10, no_support=5, party=75 → unbalanced for R2.2 too
        rule_ids = {v.rule_id for v in violations}
        assert "R2.1" not in rule_ids


# --- Helper to insert vote rows ---

def _insert_vote(conn, section_code="010100001", party_number=1, form_number=24,
                 admin_unit_id=1, total_votes=50, paper_votes=50, machine_votes=0):
    """Insert a vote row with sensible defaults."""
    conn.execute(
        "INSERT INTO votes (form_number, section_code, admin_unit_id, party_number, "
        "total_votes, paper_votes, machine_votes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (form_number, section_code, admin_unit_id, party_number,
         total_votes, paper_votes, machine_votes),
    )
    conn.commit()


# --- R3.1 Tests ---

class TestRuleR3_1:
    """R3.1: Sum of total_votes across parties = total_valid_party_votes in protocol."""

    def test_no_violation_when_sum_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", total_valid_party_votes=100)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=60)
        _insert_vote(conn, section_code="010100001", party_number=2, total_votes=40)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_1() == []

    def test_violation_when_sum_differs(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", total_valid_party_votes=100)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=60)
        _insert_vote(conn, section_code="010100001", party_number=2, total_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_1()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R3.1"
        assert v.section_code == "010100001"
        assert v.expected_value == "100"
        assert v.actual_value == "90"

    def test_single_party_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", total_valid_party_votes=75)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=75)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_1() == []

    def test_multiple_sections_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        # Section 1: matches
        _insert_protocol(conn, section_code="010100001", total_valid_party_votes=50)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=50)
        # Section 2: mismatch
        _insert_protocol(conn, section_code="010100002", total_valid_party_votes=80)
        _insert_vote(conn, section_code="010100002", party_number=1, total_votes=70)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_1()
        assert len(violations) == 1
        assert violations[0].section_code == "010100002"


# --- R3.2 Tests ---

class TestRuleR3_2:
    """R3.2: Sum of paper_votes = total_valid_party_votes (machine forms only)."""

    def test_no_violation_machine_form_paper_sum_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         total_valid_party_votes=80,
                         machine_valid_party_votes=40)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=26, total_votes=100, paper_votes=50, machine_votes=50)
        _insert_vote(conn, section_code="010100001", party_number=2,
                     form_number=26, total_votes=60, paper_votes=30, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_2() == []

    def test_violation_machine_form_paper_sum_differs(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         total_valid_party_votes=80,
                         machine_valid_party_votes=40)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=26, total_votes=100, paper_votes=60, machine_votes=40)
        _insert_vote(conn, section_code="010100001", party_number=2,
                     form_number=26, total_votes=60, paper_votes=30, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_2()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R3.2"
        assert v.expected_value == "80"
        assert v.actual_value == "90"

    def test_ignores_paper_only_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24,
                         total_valid_party_votes=80)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=24, total_votes=50, paper_votes=50, machine_votes=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_2() == []

    def test_form_30_also_checked(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=30,
                         total_valid_party_votes=50,
                         machine_valid_party_votes=20)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=30, total_votes=70, paper_votes=40, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_2()
        assert len(violations) == 1
        assert violations[0].rule_id == "R3.2"


# --- R3.3 Tests ---

class TestRuleR3_3:
    """R3.3: Sum of machine_votes = machine_valid_party_votes (machine forms only)."""

    def test_no_violation_machine_sum_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         total_valid_party_votes=80,
                         machine_valid_party_votes=60)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=26, total_votes=100, paper_votes=60, machine_votes=40)
        _insert_vote(conn, section_code="010100001", party_number=2,
                     form_number=26, total_votes=40, paper_votes=20, machine_votes=20)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_3() == []

    def test_violation_machine_sum_differs(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         total_valid_party_votes=80,
                         machine_valid_party_votes=60)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=26, total_votes=100, paper_votes=60, machine_votes=40)
        _insert_vote(conn, section_code="010100001", party_number=2,
                     form_number=26, total_votes=40, paper_votes=20, machine_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_3()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R3.3"
        assert v.expected_value == "60"
        assert v.actual_value == "50"

    def test_ignores_paper_only_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=28,
                         machine_valid_party_votes=None)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=28, total_votes=50, paper_votes=50, machine_votes=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_3() == []


# --- R3.4 Tests ---

class TestRuleR3_4:
    """R3.4: total_votes = paper_votes + machine_votes for each vote record."""

    def test_no_violation_when_decomposition_correct(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, total_votes=100, paper_votes=60, machine_votes=40)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_4() == []

    def test_violation_when_decomposition_wrong(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, section_code="010100001", party_number=5,
                     total_votes=100, paper_votes=60, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_4()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R3.4"
        assert v.section_code == "010100001"
        assert "5" in v.description
        assert v.expected_value == "90"
        assert v.actual_value == "100"

    def test_paper_only_correct(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, total_votes=50, paper_votes=50, machine_votes=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_4() == []

    def test_multiple_violations(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     total_votes=100, paper_votes=50, machine_votes=40)
        _insert_vote(conn, section_code="010100001", party_number=2,
                     total_votes=80, paper_votes=30, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_4()
        assert len(violations) == 2


# --- R3.5 Tests ---

class TestRuleR3_5:
    """R3.5: machine_votes = 0 for paper-only sections."""

    def test_no_violation_paper_section_zero_machine(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     total_votes=50, paper_votes=50, machine_votes=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_5() == []

    def test_violation_paper_section_nonzero_machine(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", party_number=3,
                     total_votes=50, paper_votes=40, machine_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_5()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R3.5"
        assert v.section_code == "010100001"
        assert "3" in v.description
        assert v.expected_value == "0"
        assert v.actual_value == "10"

    def test_form_28_also_checked(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=28)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     total_votes=50, paper_votes=45, machine_votes=5)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_5()
        assert len(violations) == 1

    def test_ignores_machine_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         machine_valid_party_votes=30)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     form_number=26, total_votes=80, paper_votes=50, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r3_5() == []

    def test_multiple_parties_with_violations(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", party_number=1,
                     total_votes=50, paper_votes=50, machine_votes=0)
        _insert_vote(conn, section_code="010100001", party_number=2,
                     total_votes=30, paper_votes=20, machine_votes=10)
        _insert_vote(conn, section_code="010100001", party_number=3,
                     total_votes=20, paper_votes=15, machine_votes=5)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r3_5()
        assert len(violations) == 2


# --- Integration: run_all with R3 rules ---

class TestRunAllR3Rules:
    """Test that R3 rules are properly registered and run via run_all()."""

    def test_r3_rules_registered(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        for rid in ("R3.1", "R3.2", "R3.3", "R3.4", "R3.5"):
            assert rid in rules, f"{rid} missing from rule registry"

    def test_run_all_finds_r3_1_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", total_valid_party_votes=100)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R3.1"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R3.1"


# --- Helper to insert preference rows ---

def _insert_preference(conn, section_code="010100001", party_number=1,
                       candidate_number="1", form_number=24,
                       total_votes=10, paper_votes=10, machine_votes=0):
    """Insert a preference row with sensible defaults."""
    conn.execute(
        "INSERT INTO preferences (form_number, section_code, party_number, "
        "candidate_number, total_votes, paper_votes, machine_votes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (form_number, section_code, party_number, candidate_number,
         total_votes, paper_votes, machine_votes),
    )
    conn.commit()


# --- R4.1 Tests ---

class TestRuleR4_1:
    """R4.1: Sum of preference total_votes (including 'Без') = total_votes for party in votes."""

    def test_no_violation_when_pref_sum_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=50)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", total_votes=30)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="Без", total_votes=20)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r4_1() == []

    def test_violation_when_pref_sum_differs(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=50)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", total_votes=30)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="Без", total_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_1()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R4.1"
        assert v.section_code == "010100001"
        assert v.expected_value == "50"
        assert v.actual_value == "40"

    def test_multiple_parties_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        # Party 1: matches
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=30)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", total_votes=30)
        # Party 2: mismatch
        _insert_vote(conn, section_code="010100001", party_number=2, total_votes=40)
        _insert_preference(conn, section_code="010100001", party_number=2,
                           candidate_number="1", total_votes=25)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_1()
        assert len(violations) == 1
        assert violations[0].description.startswith("Партия 2")

    def test_single_candidate_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=20)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", total_votes=20)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r4_1() == []


# --- R4.2 Tests ---

class TestRuleR4_2:
    """R4.2: Preference total_votes = paper_votes + machine_votes."""

    def test_no_violation_when_decomposition_correct(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_preference(conn, total_votes=50, paper_votes=30, machine_votes=20)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r4_2() == []

    def test_violation_when_decomposition_wrong(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_preference(conn, section_code="010100001", party_number=3,
                           candidate_number="2",
                           total_votes=50, paper_votes=30, machine_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_2()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R4.2"
        assert v.section_code == "010100001"
        assert v.expected_value == "40"
        assert v.actual_value == "50"

    def test_paper_only_correct(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_preference(conn, total_votes=25, paper_votes=25, machine_votes=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r4_2() == []

    def test_bez_candidate_also_checked(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_preference(conn, candidate_number="Без",
                           total_votes=15, paper_votes=10, machine_votes=3)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_2()
        assert len(violations) == 1
        assert "Без" in violations[0].description


# --- R4.3 Tests ---

class TestRuleR4_3:
    """R4.3: Preference machine_votes = 0 for paper-only sections."""

    def test_no_violation_paper_section_zero_machine(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", machine_votes=0)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r4_3() == []

    def test_violation_paper_section_nonzero_machine(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_preference(conn, section_code="010100001", party_number=2,
                           candidate_number="3",
                           total_votes=20, paper_votes=15, machine_votes=5)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_3()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R4.3"
        assert v.section_code == "010100001"
        assert v.expected_value == "0"
        assert v.actual_value == "5"

    def test_form_28_also_checked(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=28)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1",
                           total_votes=10, paper_votes=7, machine_votes=3)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_3()
        assert len(violations) == 1

    def test_ignores_machine_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         machine_valid_party_votes=30)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", form_number=26,
                           total_votes=30, paper_votes=15, machine_votes=15)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r4_3() == []

    def test_multiple_preferences_with_violations(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1",
                           total_votes=10, paper_votes=10, machine_votes=0)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="2",
                           total_votes=8, paper_votes=5, machine_votes=3)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="Без",
                           total_votes=5, paper_votes=3, machine_votes=2)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r4_3()
        assert len(violations) == 2


# --- Integration: run_all with R4 rules ---

class TestRunAllR4Rules:
    """Test that R4 rules are properly registered and run via run_all()."""

    def test_r4_rules_registered(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        for rid in ("R4.1", "R4.2", "R4.3"):
            assert rid in rules, f"{rid} missing from rule registry"

    def test_run_all_finds_r4_1_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_vote(conn, section_code="010100001", party_number=1, total_votes=50)
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", total_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R4.1"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R4.1"


# --- Helpers for R5 tests ---

def _insert_section(conn, section_code="010100001", **overrides):
    """Insert a section row with sensible defaults."""
    defaults = dict(
        section_code=section_code,
        admin_unit_id=1,
        admin_unit_name="Община",
        ekatte="00000",
        settlement_name="Село",
        address="ул. Тестова 1",
        is_mobile=0,
        is_ship=0,
        num_machines=0,
    )
    defaults.update(overrides)
    cols = ", ".join(defaults.keys())
    placeholders = ", ".join("?" for _ in defaults)
    conn.execute(f"INSERT INTO sections ({cols}) VALUES ({placeholders})", list(defaults.values()))
    conn.commit()


def _insert_cik_party(conn, party_number=1, party_name="Партия А"):
    """Insert a cik_parties row."""
    conn.execute("INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
                 (party_number, party_name))
    conn.commit()


def _insert_local_candidate(conn, rik_code=1, party_number=1, candidate_number=1,
                             party_name="Партия А", candidate_name="Кандидат А",
                             admin_unit_name="Община"):
    """Insert a local_candidates row."""
    conn.execute(
        "INSERT INTO local_candidates (rik_code, admin_unit_name, party_number, party_name, "
        "candidate_number, candidate_name) VALUES (?, ?, ?, ?, ?, ?)",
        (rik_code, admin_unit_name, party_number, party_name, candidate_number, candidate_name))
    conn.commit()


# --- R5.1 Tests ---

class TestRuleR5_1:
    """R5.1: Protocol section_code exists in sections."""

    def test_no_violation_when_section_exists(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001")
        _insert_protocol(conn, section_code="010100001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_1()
        assert len(violations) == 0

    def test_violation_when_section_missing(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="999900001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_1()
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.1"
        assert violations[0].section_code == "999900001"

    def test_multiple_protocols_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001")
        _insert_protocol(conn, section_code="010100001")
        _insert_protocol(conn, section_code="020200001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_1()
        assert len(violations) == 1
        assert violations[0].section_code == "020200001"


# --- R5.2 Tests ---

class TestRuleR5_2:
    """R5.2: Protocol rik_code = first 2 digits of section_code."""

    def test_no_violation_when_rik_matches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", rik_code=1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_2()
        assert len(violations) == 0

    def test_violation_when_rik_mismatches(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", rik_code=99)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_2()
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.2"
        assert violations[0].section_code == "010100001"
        assert violations[0].expected_value == "01"
        assert violations[0].actual_value == "99"

    def test_two_digit_rik_code(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="250100001", rik_code=25)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_2()
        assert len(violations) == 0


# --- R5.3 Tests ---

class TestRuleR5_3:
    """R5.3: Vote party_number exists in cik_parties."""

    def test_no_violation_when_party_exists(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_cik_party(conn, party_number=1)
        _insert_protocol(conn, section_code="010100001")
        _insert_vote(conn, section_code="010100001", party_number=1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_3()
        assert len(violations) == 0

    def test_violation_when_party_missing(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001")
        _insert_vote(conn, section_code="010100001", party_number=999)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_3()
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.3"
        assert violations[0].section_code == "010100001"

    def test_multiple_parties_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_cik_party(conn, party_number=1)
        _insert_protocol(conn, section_code="010100001")
        _insert_vote(conn, section_code="010100001", party_number=1)
        _insert_vote(conn, section_code="010100001", party_number=888)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_3()
        assert len(violations) == 1
        assert violations[0].actual_value == "888"


# --- R5.4 Tests ---

class TestRuleR5_4:
    """R5.4: Preference (rik, party, candidate) exists in local_candidates."""

    def test_no_violation_when_candidate_exists(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_local_candidate(conn, rik_code=1, party_number=1, candidate_number=1)
        _insert_protocol(conn, section_code="010100001")
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="1", total_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_4()
        assert len(violations) == 0

    def test_violation_when_candidate_missing(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001")
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="99", total_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_4()
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.4"
        assert violations[0].section_code == "010100001"

    def test_bez_candidate_ignored(self, db_path):
        """'Без' preferences should not be checked against local_candidates."""
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001")
        _insert_preference(conn, section_code="010100001", party_number=1,
                           candidate_number="Без", total_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_4()
        assert len(violations) == 0

    def test_rik_derived_from_section_code(self, db_path):
        """RIK code is derived from first 2 digits of section_code."""
        conn = sqlite3.connect(db_path)
        _insert_local_candidate(conn, rik_code=25, party_number=1, candidate_number=1)
        _insert_protocol(conn, section_code="250100001", rik_code=25)
        _insert_preference(conn, section_code="250100001", party_number=1,
                           candidate_number="1", total_votes=10)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_4()
        assert len(violations) == 0


# --- R5.5 Tests ---

class TestRuleR5_5:
    """R5.5: form_number ∈ {24, 26, 28, 30}."""

    def test_no_violation_valid_form_numbers(self, db_path):
        conn = sqlite3.connect(db_path)
        for i, form in enumerate([24, 26, 28, 30]):
            _insert_protocol(conn, section_code=f"01010000{i}", form_number=form)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_5()
        assert len(violations) == 0

    def test_violation_invalid_form_number(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=99)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_5()
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.5"
        assert violations[0].actual_value == "99"

    def test_mixed_valid_and_invalid(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_protocol(conn, section_code="010100002", form_number=12)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_5()
        assert len(violations) == 1
        assert violations[0].section_code == "010100002"


# --- R5.6 Tests ---

class TestRuleR5_6:
    """R5.6: Every section has a protocol (completeness)."""

    def test_no_violation_when_all_sections_have_protocols(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001")
        _insert_protocol(conn, section_code="010100001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_6()
        assert len(violations) == 0

    def test_violation_when_section_has_no_protocol(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_6()
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.6"
        assert violations[0].section_code == "010100001"

    def test_multiple_sections_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001")
        _insert_section(conn, section_code="010100002")
        _insert_protocol(conn, section_code="010100001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r5_6()
        assert len(violations) == 1
        assert violations[0].section_code == "010100002"


# --- Integration: run_all with R5 rules ---

class TestRunAllR5Rules:
    """Test that R5 rules are properly registered and run via run_all()."""

    def test_r5_rules_registered(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        for rid in ("R5.1", "R5.2", "R5.3", "R5.4", "R5.5", "R5.6"):
            assert rid in rules, f"{rid} missing from rule registry"

    def test_run_all_finds_r5_1_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="999900001")
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R5.1"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R5.1"


# --- R6.1 Tests ---

class TestRuleR6_1:
    """R6.1: machines=0 → paper-only form (24/28)."""

    def test_no_violation_zero_machines_paper_form_24(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=0)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_1() == []

    def test_no_violation_zero_machines_paper_form_28(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="320100001", num_machines=0)
        _insert_protocol(conn, section_code="320100001", form_number=28, rik_code=32)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_1() == []

    def test_violation_zero_machines_machine_form_26(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=0)
        _insert_protocol(conn, section_code="010100001", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_1()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R6.1"
        assert v.section_code == "010100001"
        assert v.expected_value == "24 или 28"
        assert v.actual_value == "26"

    def test_violation_zero_machines_machine_form_30(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=0)
        _insert_protocol(conn, section_code="010100001", form_number=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_1()
        assert len(violations) == 1
        assert violations[0].actual_value == "30"

    def test_ignores_sections_with_machines(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=2)
        _insert_protocol(conn, section_code="010100001", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_1() == []


# --- R6.2 Tests ---

class TestRuleR6_2:
    """R6.2: machines>0 → machine form (26/30)."""

    def test_no_violation_machines_machine_form_26(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=1)
        _insert_protocol(conn, section_code="010100001", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_2() == []

    def test_no_violation_machines_machine_form_30(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="320100001", num_machines=3)
        _insert_protocol(conn, section_code="320100001", form_number=30, rik_code=32)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_2() == []

    def test_violation_machines_paper_form_24(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=2)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_2()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R6.2"
        assert v.section_code == "010100001"
        assert v.expected_value == "26 или 30"
        assert v.actual_value == "24"

    def test_violation_machines_paper_form_28(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=1)
        _insert_protocol(conn, section_code="010100001", form_number=28)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_2()
        assert len(violations) == 1
        assert violations[0].actual_value == "28"

    def test_ignores_sections_without_machines(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=0)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_2() == []


# --- R6.3 Tests ---

class TestRuleR6_3:
    """R6.3: form 28/30 → section abroad (RIK code 32)."""

    def test_no_violation_form_28_abroad_section(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="320100001", form_number=28, rik_code=32)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_3() == []

    def test_no_violation_form_30_abroad_section(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="320200001", form_number=30, rik_code=32)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_3() == []

    def test_violation_form_28_domestic_section(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=28, rik_code=1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_3()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R6.3"
        assert v.section_code == "010100001"
        assert v.expected_value == "РИК код 32 (чужбина)"

    def test_violation_form_30_domestic_section(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="050100001", form_number=30, rik_code=5)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_3()
        assert len(violations) == 1
        assert violations[0].section_code == "050100001"

    def test_no_violation_domestic_paper_forms(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_protocol(conn, section_code="010100002", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_3() == []


# --- R6.4 Tests ---

class TestRuleR6_4:
    """R6.4: form_number in protocol = form_number in votes."""

    def test_no_violation_matching_form_numbers(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", form_number=24)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_4() == []

    def test_no_violation_machine_form_matching(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=26,
                         machine_valid_party_votes=30)
        _insert_vote(conn, section_code="010100001", form_number=26,
                     total_votes=80, paper_votes=50, machine_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_4() == []

    def test_violation_form_number_mismatch(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_4()
        assert len(violations) == 1
        v = violations[0]
        assert v.rule_id == "R6.4"
        assert v.section_code == "010100001"
        assert v.expected_value == "24"
        assert v.actual_value == "26"

    def test_violation_multiple_vote_rows_same_section(self, db_path):
        """Multiple vote rows for same section with wrong form — only one violation per section."""
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", party_number=1, form_number=26)
        _insert_vote(conn, section_code="010100001", party_number=2, form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r6_4()
        assert len(violations) == 1
        assert violations[0].section_code == "010100001"

    def test_no_violation_no_votes_for_section(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        conn.close()
        engine = ValidationEngine(db_path)
        assert engine._rule_r6_4() == []


# --- Integration: run_all with R6 rules ---

class TestRunAllR6Rules:
    """Test that R6 rules are properly registered and run via run_all()."""

    def test_r6_rules_registered(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        for rid in ("R6.1", "R6.2", "R6.3", "R6.4"):
            assert rid in rules, f"{rid} missing from rule registry"

    def test_run_all_finds_r6_1_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_section(conn, section_code="010100001", num_machines=0)
        _insert_protocol(conn, section_code="010100001", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R6.1"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R6.1"

    def test_run_all_finds_r6_4_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, section_code="010100001", form_number=24)
        _insert_vote(conn, section_code="010100001", form_number=26)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R6.4"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R6.4"


# --- R7.1 Tests ---

class TestRuleR7_1:
    """R7.1: 0 < received_ballots ≤ 1500."""

    def test_no_violation_within_range(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=500)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_1()
        assert len(violations) == 0

    def test_no_violation_at_upper_bound(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=1500)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_1()
        assert len(violations) == 0

    def test_no_violation_at_lower_bound(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=1)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_1()
        assert len(violations) == 0

    def test_violation_zero_ballots(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=0)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_1()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.1"
        assert violations[0].actual_value == "0"

    def test_violation_negative_ballots(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=-5)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_1()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.1"

    def test_violation_exceeds_1500(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=1501)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_1()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.1"
        assert violations[0].actual_value == "1501"


# --- R7.2 Tests ---

class TestRuleR7_2:
    """R7.2: voters_voted ≤ received_ballots."""

    def test_no_violation_when_within_limit(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=80, received_ballots=100)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_2()
        assert len(violations) == 0

    def test_no_violation_when_equal(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=100, received_ballots=100)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_2()
        assert len(violations) == 0

    def test_violation_when_exceeds(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=101, received_ballots=100)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_2()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.2"
        assert violations[0].actual_value == "101"


# --- R7.3 Tests ---

class TestRuleR7_3:
    """R7.3: ballots_in_box ≤ voters_voted."""

    def test_no_violation_when_within_limit(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, ballots_in_box=80, voters_voted=90)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_3()
        assert len(violations) == 0

    def test_no_violation_when_equal(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, ballots_in_box=90, voters_voted=90)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_3()
        assert len(violations) == 0

    def test_violation_when_exceeds(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, ballots_in_box=91, voters_voted=90)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_3()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.3"
        assert violations[0].actual_value == "91"


# --- R7.4 Tests ---

class TestRuleR7_4:
    """R7.4: Party votes ≤ voters_voted."""

    def test_no_violation_when_within_limit(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=90)
        _insert_vote(conn, total_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_4()
        assert len(violations) == 0

    def test_no_violation_when_equal(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=90)
        _insert_vote(conn, total_votes=90)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_4()
        assert len(violations) == 0

    def test_violation_when_exceeds(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=90)
        _insert_vote(conn, total_votes=91)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_4()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.4"
        assert violations[0].actual_value == "91"

    def test_multiple_parties_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, voters_voted=90)
        _insert_vote(conn, party_number=1, total_votes=50)
        _insert_vote(conn, party_number=2, total_votes=91)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_4()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.4"


# --- R7.5 Tests ---

class TestRuleR7_5:
    """R7.5: Candidate preferences ≤ party votes (excluding 'Без')."""

    def test_no_violation_when_within_limit(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        _insert_vote(conn, total_votes=50)
        _insert_preference(conn, candidate_number="1", total_votes=30)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_5()
        assert len(violations) == 0

    def test_no_violation_when_equal(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        _insert_vote(conn, total_votes=50)
        _insert_preference(conn, candidate_number="1", total_votes=50)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_5()
        assert len(violations) == 0

    def test_violation_when_exceeds(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        _insert_vote(conn, total_votes=50)
        _insert_preference(conn, candidate_number="1", total_votes=51)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_5()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.5"
        assert violations[0].actual_value == "51"

    def test_bez_candidate_excluded(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        _insert_vote(conn, total_votes=50)
        _insert_preference(conn, candidate_number="Без", total_votes=999)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_5()
        assert len(violations) == 0

    def test_multiple_candidates_mixed(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        _insert_vote(conn, total_votes=50)
        _insert_preference(conn, candidate_number="1", total_votes=30)
        _insert_preference(conn, candidate_number="2", total_votes=51)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine._rule_r7_5()
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.5"


# --- Integration: run_all with R7 rules ---

class TestRunAllR7Rules:
    """Test that R7 rules are properly registered and run via run_all()."""

    def test_r7_rules_registered(self, db_path):
        engine = ValidationEngine(db_path)
        rules = engine._get_rules()
        for rid in ("R7.1", "R7.2", "R7.3", "R7.4", "R7.5"):
            assert rid in rules, f"{rid} missing from rule registry"

    def test_run_all_finds_r7_1_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn, received_ballots=0)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R7.1"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.1"

    def test_run_all_finds_r7_5_violation(self, db_path):
        conn = sqlite3.connect(db_path)
        _insert_protocol(conn)
        _insert_vote(conn, total_votes=50)
        _insert_preference(conn, candidate_number="1", total_votes=51)
        conn.close()
        engine = ValidationEngine(db_path)
        violations = engine.run_all(rules=["R7.5"])
        assert len(violations) == 1
        assert violations[0].rule_id == "R7.5"
