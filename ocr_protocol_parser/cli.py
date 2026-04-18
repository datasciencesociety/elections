"""CLI entry point and section discovery for the OCR Protocol Parser."""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

# Pattern for section directories: 9 digits followed by .0
_SECTION_DIR_RE = re.compile(r"^\d{9}\.0$")

# Pattern for HTML page files: {section_code}.0_page_{N}.html
_PAGE_FILE_RE = re.compile(r"^(\d{9})\.0_page_(\d+)\.html$", re.IGNORECASE)


def discover_sections(
    html_dir: str, section_filter: str | None = None
) -> list[str]:
    """Return list of section directory paths matching {9-digit}.0 pattern.

    Parameters
    ----------
    html_dir : str
        Root directory containing section subdirectories.
    section_filter : str | None
        If provided, only return the directory for this section code.

    Returns
    -------
    list[str]
        Sorted list of absolute paths to section directories that contain
        at least one valid HTML page file.
    """
    root = Path(html_dir)
    if not root.is_dir():
        logger.warning("HTML directory does not exist: %s", html_dir)
        return []

    results: list[str] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if not _SECTION_DIR_RE.match(entry.name):
            continue

        # Extract section code from directory name (strip trailing .0)
        dir_section_code = entry.name[:-2]  # "010100001.0" -> "010100001"

        # Apply section filter if provided
        if section_filter is not None and dir_section_code != section_filter:
            continue

        # Check for valid HTML files in this directory
        html_files = discover_html_files(str(entry))
        if not html_files:
            logger.warning(
                "No valid HTML page files found in %s, skipping", entry.name
            )
            continue

        results.append(str(entry))

    return results


def discover_html_files(section_dir: str) -> list[str]:
    """Return sorted list of HTML page file paths within a section directory.

    Files must match the pattern ``{section_code}.0_page_{N}.html`` and are
    sorted by page number in ascending order.

    Parameters
    ----------
    section_dir : str
        Path to a section directory (e.g. ``/data/010100001.0/``).

    Returns
    -------
    list[str]
        Sorted list of absolute paths to HTML page files.
    """
    section_path = Path(section_dir)
    if not section_path.is_dir():
        return []

    files: list[tuple[int, Path]] = []
    for f in section_path.iterdir():
        if not f.is_file():
            continue
        m = _PAGE_FILE_RE.match(f.name)
        if m:
            page_num = int(m.group(2))
            files.append((page_num, f))

    files.sort(key=lambda x: x[0])
    return [str(f) for _, f in files]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments for the OCR Protocol Parser.

    Parameters
    ----------
    argv : list[str] | None
        Argument list. Defaults to ``sys.argv[1:]``.

    Returns
    -------
    argparse.Namespace
        Parsed arguments.
    """
    parser = argparse.ArgumentParser(
        description="OCR Protocol Parser — extract structured CIK-format data "
        "from OCR-ed HTML election protocol pages.",
    )
    parser.add_argument(
        "--html-dir",
        required=True,
        help="Path to the root directory containing section HTML folders.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Path to the output directory for protocols.txt, votes.txt, preferences.txt.",
    )
    parser.add_argument(
        "--section",
        default=None,
        help="Optional single section code to process (e.g. 010100001).",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level (default: INFO).",
    )
    # LLM verification options
    parser.add_argument(
        "--llm-verify",
        action="store_true",
        default=False,
        help="Enable LLM-based verification of extracted data.",
    )
    parser.add_argument(
        "--llm-api-base",
        default=os.environ.get("OPENAI_API_BASE"),
        help="OpenAI-compatible API base URL (default: env OPENAI_API_BASE).",
    )
    parser.add_argument(
        "--llm-api-key",
        default=os.environ.get("OPENAI_API_KEY"),
        help="API key for LLM verification (default: env OPENAI_API_KEY).",
    )
    parser.add_argument(
        "--llm-model",
        default="gpt-4o-mini",
        help="LLM model name (default: gpt-4o-mini).",
    )
    parser.add_argument(
        "--llm-timeout",
        type=int,
        default=30,
        help="LLM API request timeout in seconds (default: 30).",
    )

    return parser.parse_args(argv)


class _WarningCounter(logging.Handler):
    """Logging handler that counts WARNING-level messages."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.count = 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno == logging.WARNING:
            self.count += 1


def main(argv: list[str] | None = None) -> None:
    """Main entry point for the OCR Protocol Parser CLI.

    Parameters
    ----------
    argv : list[str] | None
        Argument list. Defaults to ``sys.argv[1:]``.
    """
    args = parse_args(argv)

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # Attach warning counter to root logger
    warning_counter = _WarningCounter()
    logging.getLogger().addHandler(warning_counter)

    logger.info("Starting OCR Protocol Parser")
    logger.info("HTML directory: %s", args.html_dir)
    logger.info("Output directory: %s", args.output_dir)

    # Discover sections
    sections = discover_sections(args.html_dir, section_filter=args.section)
    if not sections:
        logger.warning("No sections found to process.")
        print("Summary: 0 sections processed, 0 errors, 0 warnings")
        return

    logger.info("Found %d section(s) to process", len(sections))

    # Create LLM verifier if requested
    llm_verifier = None
    if args.llm_verify:
        from .llm_verifier import LLMVerifier
        from .models import LLMVerifierConfig

        if not args.llm_api_key:
            logger.error("--llm-verify requires --llm-api-key or OPENAI_API_KEY env var")
            raise SystemExit(1)

        config = LLMVerifierConfig(
            api_base_url=args.llm_api_base or "https://api.openai.com/v1",
            api_key=args.llm_api_key,
            model=args.llm_model,
            timeout=args.llm_timeout,
            enabled=True,
        )
        llm_verifier = LLMVerifier(config)
        logger.info("LLM verification enabled (model=%s)", args.llm_model)

    # Process sections
    from .models import PreferenceRecord, ProtocolRecord, VoteRecord
    from .section_processor import SectionProcessor

    all_protocols: list[ProtocolRecord] = []
    all_votes: list[VoteRecord] = []
    all_preferences: list[PreferenceRecord] = []

    error_count = 0

    for section_dir in sections:
        section_name = Path(section_dir).name
        try:
            processor = SectionProcessor(section_dir, llm_verifier=llm_verifier)
            protocol, votes, preferences = processor.process()
            all_protocols.append(protocol)
            all_votes.append(votes)
            all_preferences.extend(preferences)
            logger.info("Processed section %s", section_name)
        except Exception:
            logger.error("Error processing section %s", section_name, exc_info=True)
            error_count += 1

    # Write output files
    from .output_writer import write_preferences, write_protocols, write_votes

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    write_protocols(all_protocols, str(output_dir / "protocols.txt"))
    write_votes(all_votes, str(output_dir / "votes.txt"))
    write_preferences(all_preferences, str(output_dir / "preferences.txt"))

    logger.info("Output written to %s", args.output_dir)

    # Summary report
    total_processed = len(sections) - error_count
    print(
        f"Summary: {total_processed} sections processed, "
        f"{error_count} errors, {warning_counter.count} warnings"
    )
