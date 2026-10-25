"""Data Loader — reads CSV files and imports them into SQLite."""

import logging
import os
import sqlite3
import sys
from collections.abc import Iterator

try:
    from .validator import SQLITE_SCHEMA
except ImportError:
    from validator import SQLITE_SCHEMA

logger = logging.getLogger(__name__)

# Form numbers for paper-only protocols (no machine columns)
PAPER_ONLY_FORMS = {24, 28}
# Form numbers for machine protocols (have machine columns 18-20)
MACHINE_FORMS = {26, 30}


def _safe_int(value: str) -> int | None:
    """Convert a string to int, returning None for empty/whitespace strings."""
    value = value.strip()
    if not value:
        return None
    return int(value)


def validate_folder(data_dir: str) -> None:
    """Validate that data_dir exists, is a directory, and is readable.

    Raises:
        SystemExit: If validation fails.
    """
    if not os.path.exists(data_dir):
        msg = f"Пътят не съществува: {data_dir}"
        logger.error(msg)
        sys.exit(msg)
    if not os.path.isdir(data_dir):
        msg = f"Пътят не е директория: {data_dir}"
        logger.error(msg)
        sys.exit(msg)
    if not os.access(data_dir, os.R_OK):
        msg = f"Директорията не е достъпна: {data_dir}"
        logger.error(msg)
        sys.exit(msg)


FILE_TYPE_PREFIXES = [
    "cik_parties",
    "local_parties",
    "local_candidates",
    "sections",
    "protocols",
    "votes",
    "preferences",
]


def discover_files(data_dir: str) -> dict[str, str]:
    """Scan data_dir and return {file_type: filename} mapping.

    Matches files whose name starts with a prefix from FILE_TYPE_PREFIXES
    followed by '_', any characters, and ending with '.txt'.
    Matching is case-insensitive on the prefix.

    Raises:
        SystemExit: If a required file type is missing or ambiguous.
    """
    # Collect all .txt files in the directory
    try:
        entries = os.listdir(data_dir)
    except OSError as exc:
        msg = f"Грешка при четене на директорията: {data_dir} ({exc})"
        logger.error(msg)
        sys.exit(msg)

    txt_files = [e for e in entries if e.lower().endswith(".txt") and os.path.isfile(os.path.join(data_dir, e))]

    # For each prefix, find matching files
    matches: dict[str, list[str]] = {prefix: [] for prefix in FILE_TYPE_PREFIXES}

    for filename in txt_files:
        name_lower = filename.lower()
        for prefix in FILE_TYPE_PREFIXES:
            if name_lower.startswith(prefix + "_"):
                matches[prefix].append(filename)
                break  # a file matches at most one prefix

    # Validate: check for ambiguous matches first, then missing
    for prefix in FILE_TYPE_PREFIXES:
        found = matches[prefix]
        if len(found) > 1:
            filelist = ", ".join(sorted(found))
            msg = (
                f"Намерени са няколко файла за тип '{prefix}' "
                f"в {data_dir}: {filelist}"
            )
            logger.error(msg)
            sys.exit(msg)

    for prefix in FILE_TYPE_PREFIXES:
        found = matches[prefix]
        if len(found) == 0:
            msg = (
                f"Липсва файл за тип '{prefix}' "
                f"в директория: {data_dir}"
            )
            logger.error(msg)
            sys.exit(msg)

    return {prefix: matches[prefix][0] for prefix in FILE_TYPE_PREFIXES}


class DataLoader:
    """Loads semicolon-delimited election data files into a SQLite database."""

    def __init__(self, db_path: str, data_dir: str) -> None:
        self.db_path = db_path
        self.data_dir = data_dir

        # Validate folder and discover files
        validate_folder(data_dir)
        self._files = discover_files(data_dir)

        # Connect and (re)create all tables
        self.conn = sqlite3.connect(db_path)
        self._recreate_tables()

    def _recreate_tables(self) -> None:
        """Drop all existing tables and recreate from schema."""
        cursor = self.conn.cursor()
        # Fetch existing table names
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        tables = [row[0] for row in cursor.fetchall()]
        for table in tables:
            cursor.execute(f"DROP TABLE IF EXISTS [{table}]")
        # Drop existing indexes too (some may survive table drops)
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND name NOT LIKE 'sqlite_%'"
        )
        indexes = [row[0] for row in cursor.fetchall()]
        for idx in indexes:
            cursor.execute(f"DROP INDEX IF EXISTS [{idx}]")
        self.conn.commit()
        self.conn.executescript(SQLITE_SCHEMA)

    def _read_file(self, filename: str) -> Iterator[list[str]]:
        """Read a semicolon-delimited file, yielding rows as lists of strings.

        Tries UTF-8 first; falls back to Windows-1251 on decode error.
        """
        filepath = os.path.join(self.data_dir, filename)
        encodings = ["utf-8", "windows-1251"]

        for encoding in encodings:
            try:
                with open(filepath, encoding=encoding) as fh:
                    for line in fh:
                        line = line.rstrip("\n\r")
                        if line:
                            yield line.split(";")
                return  # success — stop trying encodings
            except UnicodeDecodeError:
                continue  # try next encoding

        # Neither encoding worked
        msg = (
            f"Неуспешно четене на файл {filename}: "
            "нито UTF-8, нито Windows-1251 кодиране"
        )
        logger.error(msg)
        sys.exit(msg)

    # ------------------------------------------------------------------
    # Individual loader stubs (to be implemented in subsequent tasks)
    # ------------------------------------------------------------------

    def _load_cik_parties(self) -> int:
        """Parse cik_parties file and INSERT into cik_parties table.

        File format: party_number;party_name
        """
        rows = [
            (int(fields[0]), fields[1])
            for fields in self._read_file(self._files["cik_parties"])
            if len(fields) >= 2
        ]
        self.conn.executemany(
            "INSERT INTO cik_parties (party_number, party_name) VALUES (?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def _load_local_parties(self) -> int:
        """Parse local_parties file and INSERT into local_parties table.

        File format: rik_code;admin_unit_name;party_number;party_name
        """
        rows = [
            (int(fields[0]), fields[1], int(fields[2]), fields[3])
            for fields in self._read_file(self._files["local_parties"])
            if len(fields) >= 4
        ]
        self.conn.executemany(
            "INSERT INTO local_parties (rik_code, admin_unit_name, party_number, party_name) "
            "VALUES (?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def _load_local_candidates(self) -> int:
        """Parse local_candidates file and INSERT into local_candidates table.

        File format: rik_code;admin_unit_name;party_number;party_name;candidate_number;candidate_name
        """
        rows = [
            (int(fields[0]), fields[1], int(fields[2]), fields[3], int(fields[4]), fields[5])
            for fields in self._read_file(self._files["local_candidates"])
            if len(fields) >= 6
        ]
        self.conn.executemany(
            "INSERT INTO local_candidates "
            "(rik_code, admin_unit_name, party_number, party_name, candidate_number, candidate_name) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def _load_sections(self) -> int:
        """Parse sections file and INSERT into sections table.

        Supports two formats (auto-detected from first data row):
        - 9 cols (2024):  section_code;admin_unit_id;admin_unit_name;ekatte;settlement;address;is_mobile;is_ship;num_machines
        - 11 cols (2026): section_code;admin_unit_id;admin_unit_name;ekatte;settlement;address;longitude;latitude;is_mobile;is_ship;num_machines
        """
        rows: list[tuple] = []
        has_coords: bool | None = None  # detected from first row

        for fields in self._read_file(self._files["sections"]):
            if len(fields) < 9:
                continue

            # Detect format once from the first row
            if has_coords is None:
                has_coords = len(fields) >= 11

            if has_coords:
                if len(fields) < 11:
                    continue
                rows.append((
                    fields[0],                                        # section_code
                    int(fields[1]),                                   # admin_unit_id
                    fields[2],                                        # admin_unit_name
                    fields[3],                                        # ekatte
                    fields[4],                                        # settlement_name
                    fields[5],                                        # address
                    float(fields[6]) if fields[6].strip() else None,  # longitude
                    float(fields[7]) if fields[7].strip() else None,  # latitude
                    int(fields[8]) if fields[8] else 0,               # is_mobile
                    int(fields[9]) if fields[9] else 0,               # is_ship
                    int(fields[10]) if fields[10] else 0,             # num_machines
                ))
            else:
                rows.append((
                    fields[0],                                        # section_code
                    int(fields[1]),                                   # admin_unit_id
                    fields[2],                                        # admin_unit_name
                    fields[3],                                        # ekatte
                    fields[4],                                        # settlement_name
                    fields[5],                                        # address
                    None,                                             # longitude
                    None,                                             # latitude
                    int(fields[6]) if fields[6] else 0,               # is_mobile
                    int(fields[7]) if fields[7] else 0,               # is_ship
                    int(fields[8]) if fields[8] else 0,               # num_machines
                ))

        self.conn.executemany(
            "INSERT INTO sections "
            "(section_code, admin_unit_id, admin_unit_name, ekatte, settlement_name, "
            "address, longitude, latitude, is_mobile, is_ship, num_machines) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def _load_protocols(self) -> int:
        """Parse protocols file and INSERT into protocols table.

        Column mapping:
          0: form_number, 1: section_code, 2: rik_code, 3: page_numbers,
          4-5: (empty/unused), 6: received_ballots, 7: voters_in_list,
          8: voters_supplementary, 9: voters_voted,
          10: unused_ballots, 11: spoiled_ballots, 12: ballots_in_box,
          13: invalid_votes, 14: valid_no_support, 15: total_valid_party_votes,
          16: machine_ballots_in_box (26/30 only),
          17: machine_no_support (26/30 only),
          18: machine_valid_party_votes (26/30 only).

        Paper-only forms (24/28) have no columns 18-20; those fields are set to NULL.
        """
        rows: list[tuple] = []
        for fields in self._read_file(self._files["protocols"]):
            if len(fields) < 16:
                logger.warning("Пропуснат ред с недостатъчно колони: %s", fields)
                continue

            form_number = _safe_int(fields[0])
            section_code = fields[1].strip()
            rik_code = _safe_int(fields[2])
            page_numbers = fields[3].strip() or None  # TEXT, pipe-delimited

            # Columns 4-5 are empty/unused — skip them
            received_ballots = _safe_int(fields[6])
            voters_in_list = _safe_int(fields[7])
            voters_supplementary = _safe_int(fields[8])
            voters_voted = _safe_int(fields[9])
            unused_ballots = _safe_int(fields[10])
            spoiled_ballots = _safe_int(fields[11])
            ballots_in_box = _safe_int(fields[12])
            invalid_votes = _safe_int(fields[13])
            valid_no_support = _safe_int(fields[14])
            total_valid_party_votes = _safe_int(fields[15])

            # Machine columns: present only for forms 26/30
            if form_number in MACHINE_FORMS and len(fields) >= 19:
                machine_ballots_in_box = _safe_int(fields[16])
                machine_no_support = _safe_int(fields[17])
                machine_valid_party_votes = _safe_int(fields[18])
            else:
                machine_ballots_in_box = None
                machine_no_support = None
                machine_valid_party_votes = None

            rows.append((
                form_number,
                section_code,
                rik_code,
                page_numbers,
                received_ballots,
                voters_in_list,
                voters_supplementary,
                voters_voted,
                unused_ballots,
                spoiled_ballots,
                ballots_in_box,
                invalid_votes,
                valid_no_support,
                total_valid_party_votes,
                machine_ballots_in_box,
                machine_no_support,
                machine_valid_party_votes,
            ))

        self.conn.executemany(
            "INSERT INTO protocols "
            "(form_number, section_code, rik_code, page_numbers, "
            "received_ballots, voters_in_list, voters_supplementary, voters_voted, "
            "unused_ballots, spoiled_ballots, ballots_in_box, "
            "invalid_votes, valid_no_support, total_valid_party_votes, "
            "machine_ballots_in_box, machine_no_support, machine_valid_party_votes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def _load_votes(self) -> int:
        """Parse votes file and INSERT into votes table.

        File format: form;section;admin_unit;party1;votes1;paper1;machine1;party2;votes2;paper2;machine2;...

        First 3 fields are header (form_number, section_code, admin_unit_id).
        Then repeating groups of 4: party_number, total_votes, paper_votes, machine_votes.
        Each complete group becomes one row in the votes table.
        Incomplete trailing groups are skipped with a warning.
        """
        rows: list[tuple] = []
        for fields in self._read_file(self._files["votes"]):
            if len(fields) < 3:
                logger.warning("Пропуснат ред с недостатъчно колони: %s", fields)
                continue

            form_number = _safe_int(fields[0])
            section_code = fields[1].strip()
            admin_unit_id = _safe_int(fields[2])

            party_fields = fields[3:]
            num_complete_groups = len(party_fields) // 4
            remainder = len(party_fields) % 4

            if remainder:
                logger.warning(
                    "Непълна група партия за секция %s: %d излишни полета — пропуснати",
                    section_code,
                    remainder,
                )

            for i in range(num_complete_groups):
                offset = i * 4
                party_number = _safe_int(party_fields[offset])
                total_votes = _safe_int(party_fields[offset + 1])
                paper_votes = _safe_int(party_fields[offset + 2])
                machine_votes = _safe_int(party_fields[offset + 3])

                rows.append((
                    form_number,
                    section_code,
                    admin_unit_id,
                    party_number,
                    total_votes,
                    paper_votes,
                    machine_votes,
                ))

        self.conn.executemany(
            "INSERT INTO votes "
            "(form_number, section_code, admin_unit_id, party_number, "
            "total_votes, paper_votes, machine_votes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def _load_preferences(self) -> int:
        """Parse preferences file and INSERT into preferences table.

        File format: form_number;section_code;party_number;candidate_number;total_votes;paper_votes;machine_votes

        candidate_number is TEXT (not int) because "Без" is a valid value.
        Uses iterator-based batch inserts (batches of 10000) for large files (>50MB).
        """
        BATCH_SIZE = 10_000
        batch: list[tuple] = []
        total = 0

        for fields in self._read_file(self._files["preferences"]):
            if len(fields) < 7:
                logger.warning("Пропуснат ред с недостатъчно колони в preferences: %s", fields)
                continue

            batch.append((
                _safe_int(fields[0]),       # form_number
                fields[1].strip(),          # section_code
                _safe_int(fields[2]),       # party_number
                fields[3].strip(),          # candidate_number (TEXT — "Без" is valid)
                _safe_int(fields[4]),       # total_votes
                _safe_int(fields[5]),       # paper_votes
                _safe_int(fields[6]),       # machine_votes
            ))

            if len(batch) >= BATCH_SIZE:
                self.conn.executemany(
                    "INSERT INTO preferences "
                    "(form_number, section_code, party_number, candidate_number, "
                    "total_votes, paper_votes, machine_votes) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    batch,
                )
                total += len(batch)
                batch.clear()

        # Flush remaining rows
        if batch:
            self.conn.executemany(
                "INSERT INTO preferences "
                "(form_number, section_code, party_number, candidate_number, "
                "total_votes, paper_votes, machine_votes) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                batch,
            )
            total += len(batch)

        self.conn.commit()
        return total

    def load_all(self) -> dict[str, int]:
        """Load all 7 files in correct order and return {table_name: row_count}.

        Loading order: cik_parties, local_parties, local_candidates,
        sections, protocols, votes, preferences.
        Logs the row count for each table after loading.
        """
        loaders = [
            ("cik_parties", self._load_cik_parties),
            ("local_parties", self._load_local_parties),
            ("local_candidates", self._load_local_candidates),
            ("sections", self._load_sections),
            ("protocols", self._load_protocols),
            ("votes", self._load_votes),
            ("preferences", self._load_preferences),
        ]

        counts: dict[str, int] = {}
        for table_name, loader_fn in loaders:
            row_count = loader_fn()
            counts[table_name] = row_count
            logger.info("Заредени %d реда в таблица %s", row_count, table_name)

        # Create indexes for validation query performance
        logger.info("Създаване на индекси ...")
        self.conn.executescript("""
            CREATE INDEX IF NOT EXISTS idx_votes_section_party ON votes(section_code, party_number);
            CREATE INDEX IF NOT EXISTS idx_preferences_section_party ON preferences(section_code, party_number);
            CREATE INDEX IF NOT EXISTS idx_preferences_section ON preferences(section_code);
            CREATE INDEX IF NOT EXISTS idx_protocols_form ON protocols(form_number);
            CREATE INDEX IF NOT EXISTS idx_votes_party ON votes(party_number);
        """)
        logger.info("Индекси създадени.")

        return counts
