"""CLI entry point for the Election Data Validator."""

import argparse
import logging
import sys

from .loader import DataLoader
from .reporter import ReportGenerator
from .validator import ValidationEngine


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments.

    Args:
        argv: Argument list (defaults to sys.argv[1:] when None).

    Returns:
        Parsed namespace with data_dir, rules, output, db.
    """
    parser = argparse.ArgumentParser(
        description="Валидатор на данни от парламентарни избори в България (27.10.2024)",
    )
    parser.add_argument(
        "data_dir",
        help="Път до директорията с данни от изборите",
    )
    parser.add_argument(
        "--rules",
        nargs="+",
        default=None,
        help="Списък от rule_id за изпълнение (напр. R2.1 R3.4). По подразбиране — всички.",
    )
    parser.add_argument(
        "--output",
        default="validation_report.csv",
        help="Път за CSV отчета (default: validation_report.csv)",
    )
    parser.add_argument(
        "--db",
        default="election_data.db",
        help="Път за SQLite файла (default: election_data.db)",
    )
    parser.add_argument(
        "--sections-dir",
        default="sections_report",
        help="Директория за CSV файлове по секции (default: sections_report)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Parse args, run loader, run validations, generate report."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger = logging.getLogger(__name__)

    args = parse_args(argv)

    # 1. Load data
    logger.info("Зареждане на данни от %s ...", args.data_dir)
    loader = DataLoader(db_path=args.db, data_dir=args.data_dir)
    counts = loader.load_all()
    for table, count in counts.items():
        logger.info("  %s: %d реда", table, count)

    # 2. Validate
    logger.info("Стартиране на валидация ...")
    engine = ValidationEngine(db_path=args.db)
    violations = engine.run_all(rules=args.rules)

    # 3. Determine which rules were run (for summary)
    if args.rules is not None:
        rules_run = args.rules
    else:
        rules_run = list(engine._get_rules().keys())

    # 4. Report
    reporter = ReportGenerator()
    reporter.write_csv(violations, args.output)
    logger.info("CSV отчет записан в %s", args.output)
    section_count = reporter.write_per_section(violations, args.sections_dir)
    logger.info("Създадени %d файла по секции в %s", section_count, args.sections_dir)
    reporter.print_summary(violations, rules_run)


if __name__ == "__main__":
    main()
