"""Report Generator — produces CSV and console summary of validation results."""

import csv
import os
from collections import Counter, defaultdict

from .validator import Violation


class ReportGenerator:
    """Generates CSV report and console summary of validation violations."""

    def write_csv(self, violations: list[Violation], output_path: str) -> None:
        """Write violations to a semicolon-delimited CSV file.

        Columns: rule_id, section_code, description, expected_value, actual_value.
        Encoding: UTF-8.
        """
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(["rule_id", "section_code", "description", "expected_value", "actual_value"])
            for v in violations:
                writer.writerow([v.rule_id, v.section_code, v.description, v.expected_value, v.actual_value])

    def write_per_section(self, violations: list[Violation], output_dir: str) -> int:
        """Write one CSV per section that has violations.

        Each file is named {section_code}.csv and contains only that section's violations.
        Returns the number of section files created.
        """
        by_section: dict[str, list[Violation]] = defaultdict(list)
        for v in violations:
            by_section[v.section_code].append(v)

        os.makedirs(output_dir, exist_ok=True)

        for section_code, section_violations in by_section.items():
            path = os.path.join(output_dir, f"{section_code}.csv")
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f, delimiter=";")
                writer.writerow(["rule_id", "section_code", "description", "expected_value", "actual_value"])
                for v in section_violations:
                    writer.writerow([v.rule_id, v.section_code, v.description, v.expected_value, v.actual_value])

        return len(by_section)

    def print_summary(self, violations: list[Violation], rules_run: list[str]) -> None:
        """Print a human-readable summary in Bulgarian to stdout.

        Shows violation count per rule and marks rules with no violations as OK.
        """
        counts: Counter[str] = Counter(v.rule_id for v in violations)

        print("=== Резултати от валидацията ===")
        print()

        for rule_id in sorted(rules_run):
            count = counts.get(rule_id, 0)
            if count > 0:
                print(f"  {rule_id}: {count} нарушения")
            else:
                print(f"  {rule_id}: OK")

        print()
        total = len(violations)
        print(f"Общо нарушения: {total}")
