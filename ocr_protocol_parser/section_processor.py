"""Per-section orchestration for the OCR Protocol Parser.

SectionProcessor loads HTML files from a section directory, delegates
parsing to page-specific functions, optionally verifies via LLM, and
aggregates results into ProtocolRecord, VoteRecord, and PreferenceRecord.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from pathlib import Path

from .html_utils import parse_html_file, parse_html_file_flush
from .models import (
    FormTypeError,
    MachinePreferencesData,
    MachineVotesData,
    PaperPreferencesData,
    PaperVotesData,
    PreferenceRecord,
    ProtocolRecord,
    VoteRecord,
)
from .page_parsers import (
    parse_machine_fields_page7,
    parse_machine_preference_pages,
    parse_machine_vote_pages,
    parse_page1,
    parse_page2,
    parse_preference_pages,
    parse_vote_pages,
    validate_control_number,
)
from .region_candidates import get_num_candidates, load_max_candidates

logger = logging.getLogger(__name__)

# Regex to extract page number from filename like "010100001.0_page_3.html"
_PAGE_NUM_RE = re.compile(r"_page_(\d+)\.html$", re.IGNORECASE)


class SectionProcessor:
    """Process all HTML pages of a single election section."""

    def __init__(self, section_dir: str, llm_verifier=None, max_candidates: dict[int, int] | None = None) -> None:
        self.section_dir = Path(section_dir)
        self.llm_verifier = llm_verifier
        self.max_candidates = max_candidates or load_max_candidates()
        self.html_files = self._load_html_files()
        # Determine the highest page number present
        self.max_page = 0
        for f in self.html_files:
            m = _PAGE_NUM_RE.search(f.name)
            if m:
                self.max_page = max(self.max_page, int(m.group(1)))

    def _load_html_files(self) -> list[Path]:
        """Load HTML files from section directory, sorted by page number."""
        files: list[tuple[int, Path]] = []
        for f in self.section_dir.iterdir():
            if not f.is_file() or not f.suffix.lower() == ".html":
                continue
            m = _PAGE_NUM_RE.search(f.name)
            if m:
                page_num = int(m.group(1))
                files.append((page_num, f))
        files.sort(key=lambda x: x[0])
        return [f for _, f in files]

    def _get_page(self, page_num: int) -> Path | None:
        """Return the file path for a given page number, or None."""
        for f in self.html_files:
            m = _PAGE_NUM_RE.search(f.name)
            if m and int(m.group(1)) == page_num:
                return f
        return None

    def _read_raw_html(self, path: Path) -> str:
        """Read raw HTML content from a file."""
        return path.read_text(encoding="utf-8")

    def _warn_missing_page(self, page_num: int) -> None:
        """Warn about a missing page only if it's within the range of existing pages."""
        if page_num <= self.max_page:
            logger.warning("Page %d not found in %s (gap in pages 1-%d)",
                           page_num, self.section_dir, self.max_page)

    def process(self) -> tuple[ProtocolRecord, VoteRecord, list[PreferenceRecord]]:
        """Orchestrate page parsing and aggregation for this section.

        Returns
        -------
        tuple[ProtocolRecord, VoteRecord, list[PreferenceRecord]]
            The aggregated protocol, vote, and preference records.

        Raises
        ------
        FormTypeError
            If the form type cannot be detected on page 1.
        """
        # --- Page 1: header fields and form type ---
        page1_path = self._get_page(1)
        if page1_path is None:
            raise FormTypeError(f"Page 1 not found in {self.section_dir}")
        page1_divs = parse_html_file(str(page1_path))
        validate_control_number(page1_divs, f"Section {self.section_dir.name} page 1")
        page1_data = parse_page1(page1_divs)

        if self.llm_verifier is not None:
            raw_html = self._read_raw_html(page1_path)
            page1_data = self.llm_verifier.verify_page1(raw_html, page1_data)

        # Validate section code matches directory name
        dir_section_code = self.section_dir.name.replace(".0", "")
        if page1_data.section_code and page1_data.section_code != dir_section_code:
            logger.warning(
                "Section code mismatch: directory=%s, parsed=%s (using directory code)",
                dir_section_code, page1_data.section_code,
            )
            page1_data.section_code = dir_section_code
        elif not page1_data.section_code:
            page1_data.section_code = dir_section_code

        form_type = page1_data.form_type
        is_machine_form = form_type in (26, 30)
        num_candidates = get_num_candidates(page1_data.section_code, self.max_candidates)

        # Collect all control numbers
        all_control_numbers: list[str] = [page1_data.control_number]

        # --- Page 2: voter/ballot data ---
        page2_path = self._get_page(2)
        if page2_path is not None:
            page2_divs = parse_html_file(str(page2_path))
            validate_control_number(page2_divs, f"Section {self.section_dir.name} page 2")
            page2_data = parse_page2(page2_divs)
            if self.llm_verifier is not None:
                raw_html = self._read_raw_html(page2_path)
                page2_data = self.llm_verifier.verify_page2(raw_html, page2_data)
            all_control_numbers.append(page2_data.control_number)
        else:
            self._warn_missing_page(2)
            page2_data = None

        # --- Pages 3-4: paper votes ---
        vote_divs_list = []
        for pn in (3, 4):
            p = self._get_page(pn)
            if p is not None:
                divs = parse_html_file(str(p))
                validate_control_number(divs, f"Section {self.section_dir.name} page {pn}")
                vote_divs_list.append(divs)
            else:
                self._warn_missing_page(pn)

        paper_votes: PaperVotesData | None = None
        if vote_divs_list:
            paper_votes = parse_vote_pages(vote_divs_list)
            if self.llm_verifier is not None:
                raw_htmls = []
                for pn in (3, 4):
                    p = self._get_page(pn)
                    if p is not None:
                        raw_htmls.append(self._read_raw_html(p))
                paper_votes = self.llm_verifier.verify_votes(raw_htmls, paper_votes)
            all_control_numbers.extend(paper_votes.control_numbers)

        # --- Pages 5-7: paper preferences (use flush for truncated pages) ---
        pref_divs_list = []
        for pn in (5, 6, 7):
            p = self._get_page(pn)
            if p is not None:
                divs = parse_html_file_flush(str(p))
                validate_control_number(divs, f"Section {self.section_dir.name} page {pn}")
                pref_divs_list.append(divs)
            else:
                self._warn_missing_page(pn)

        paper_prefs: PaperPreferencesData | None = None
        if pref_divs_list:
            paper_prefs = parse_preference_pages(pref_divs_list, num_candidates)
            if self.llm_verifier is not None:
                raw_htmls = []
                for pn in (5, 6, 7):
                    p = self._get_page(pn)
                    if p is not None:
                        raw_htmls.append(self._read_raw_html(p))
                paper_prefs = self.llm_verifier.verify_preferences(raw_htmls, paper_prefs)
            all_control_numbers.extend(paper_prefs.control_numbers)

        # --- Machine data (Form 26/30 only) ---
        machine_votes: MachineVotesData | None = None
        machine_prefs: MachinePreferencesData | None = None

        if is_machine_form:
            # Machine fields (11. and 12.) can be on any page from 5 onwards
            # Scan all pages to find them
            machine_ballots_found: int | None = None
            no_support_found: int | None = None
            for pn in range(5, self.max_page + 1):
                p = self._get_page(pn)
                if p is not None:
                    page_divs = parse_html_file_flush(str(p))
                    mb, ns = parse_machine_fields_page7(page_divs)
                    if machine_ballots_found is None and mb is not None:
                        machine_ballots_found = mb
                    if no_support_found is None and ns is not None:
                        no_support_found = ns
                    if machine_ballots_found is not None and no_support_found is not None:
                        break

            if machine_ballots_found is None:
                logger.warning("Machine ballots in box (field 19) not found in section %s",
                               self.section_dir.name)
            if no_support_found is None:
                logger.warning("Machine no-support votes (field 20) not found in section %s",
                               self.section_dir.name)

            # Machine vote pages — find pages with "13. РАЗПРЕДЕЛЕНИЕ" header
            # or continuation vote tables AFTER the paper preference pages
            machine_vote_start = 0
            machine_vote_divs = []
            for pn in range(7, self.max_page + 1):
                p = self._get_page(pn)
                if p is not None:
                    divs = parse_html_file(str(p))
                    has_machine_header = any(
                        "13." in d.content and "разпределение" in d.content.lower()
                        for d in divs if d.label in ("Section-Header", "Text")
                    )
                    if has_machine_header:
                        machine_vote_start = pn
                        validate_control_number(divs, f"Section {self.section_dir.name} page {pn}")
                        machine_vote_divs.append(divs)
                        break

            # Collect continuation pages after the header page
            if machine_vote_start > 0:
                for pn in range(machine_vote_start + 1, self.max_page + 1):
                    p = self._get_page(pn)
                    if p is not None:
                        divs = parse_html_file(str(p))
                        # Check for vote rows or total "14. Общ брой"
                        has_vote_rows = any(
                            d.label in ("Table", "Form") and d.tables
                            and any(
                                row and len(row) >= 3
                                and re.match(r"^\d+\.", row[0].strip())
                                and any("с цифри" in c.lower() or "с думи" in c.lower() for c in row[1:])
                                for table in d.tables for row in table
                            )
                            for d in divs
                        )
                        has_total = any(
                            "14." in d.content and "общ" in d.content.lower() and "бро" in d.content.lower()
                            for d in divs if d.label == "Text"
                        )
                        # Stop if we hit a preference page (has "15." or "преференци" header)
                        has_pref_header = any(
                            ("15." in d.content or "преференци" in d.content.lower())
                            and d.label in ("Section-Header",)
                            for d in divs
                        )
                        if has_pref_header:
                            break
                        if has_vote_rows or has_total:
                            validate_control_number(divs, f"Section {self.section_dir.name} page {pn}")
                            machine_vote_divs.append(divs)
                        else:
                            break

            if machine_vote_divs:
                machine_votes = parse_machine_vote_pages(machine_vote_divs)

                # If total not found in vote pages, search all remaining pages
                total_machine = machine_votes.total_valid_machine_votes
                if total_machine is None:
                    from .page_parsers import _parse_total_valid_machine_votes
                    for pn in range(7, self.max_page + 1):
                        p = self._get_page(pn)
                        if p is not None:
                            page_divs = parse_html_file_flush(str(p))
                            total_machine = _parse_total_valid_machine_votes(page_divs)
                            if total_machine is not None:
                                break

                machine_votes = MachineVotesData(
                    control_numbers=machine_votes.control_numbers,
                    votes=machine_votes.votes,
                    machine_ballots_in_box=machine_ballots_found,
                    no_support_votes_machine=no_support_found,
                    total_valid_machine_votes=total_machine,
                )
                if total_machine is None:
                    logger.warning("Total valid machine votes not found in section %s",
                                   self.section_dir.name)
                if self.llm_verifier is not None:
                    raw_htmls = [self._read_raw_html(self._get_page(pn))
                                 for pn in range(8, self.max_page + 1)
                                 if self._get_page(pn) is not None][:2]
                    machine_votes = self.llm_verifier.verify_machine_votes(
                        raw_htmls, machine_votes
                    )
                all_control_numbers.extend(machine_votes.control_numbers)
            elif machine_ballots_found is not None or no_support_found is not None:
                machine_votes = MachineVotesData(
                    control_numbers=[],
                    votes=[],
                    machine_ballots_in_box=machine_ballots_found,
                    no_support_votes_machine=no_support_found,
                    total_valid_machine_votes=None,
                )

            # Machine preferences — pages after machine votes
            machine_pref_start = max(pn for pn in range(1, self.max_page + 1) if self._get_page(pn)) if machine_vote_divs else 10
            # Start after the last machine vote page
            if machine_vote_divs:
                # Find the page number of the last machine vote page
                last_vote_page = 7
                for check_pn in range(7, self.max_page + 1):
                    p = self._get_page(check_pn)
                    if p is not None:
                        d = parse_html_file(str(p))
                        has_header = any(
                            "13." in dd.content and "разпределение" in dd.content.lower()
                            for dd in d if dd.label in ("Section-Header", "Text")
                        )
                        has_total = any(
                            "14." in dd.content and "общ" in dd.content.lower() and "бро" in dd.content.lower()
                            for dd in d if dd.label == "Text"
                        )
                        if has_header or has_total:
                            last_vote_page = check_pn
                machine_pref_start = last_vote_page + 1
            
            machine_pref_divs = []
            for pn in range(machine_pref_start, self.max_page + 1):
                p = self._get_page(pn)
                if p is not None:
                    divs = parse_html_file_flush(str(p))
                    validate_control_number(divs, f"Section {self.section_dir.name} page {pn}")
                    machine_pref_divs.append(divs)

            if machine_pref_divs:
                machine_prefs = parse_machine_preference_pages(machine_pref_divs, num_candidates)
                if self.llm_verifier is not None:
                    raw_htmls = [self._read_raw_html(self._get_page(pn))
                                 for pn in range(10, self.max_page + 1)
                                 if self._get_page(pn) is not None]
                    machine_prefs = self.llm_verifier.verify_machine_preferences(
                        raw_htmls, machine_prefs
                    )
                all_control_numbers.extend(machine_prefs.control_numbers)

        # --- Aggregate results ---
        protocol = self._build_protocol_record(
            page1_data, page2_data, paper_votes, machine_votes,
            all_control_numbers, is_machine_form,
        )
        votes = self._build_vote_record(
            page1_data, paper_votes, machine_votes, is_machine_form,
        )
        preferences = self._build_preference_records(
            page1_data, paper_prefs, machine_prefs, is_machine_form,
        )

        return protocol, votes, preferences

    @staticmethod
    def _build_protocol_record(
        page1_data,
        page2_data,
        paper_votes,
        machine_votes,
        all_control_numbers,
        is_machine_form: bool,
    ) -> ProtocolRecord:
        """Aggregate page data into a ProtocolRecord."""
        # Pipe-separated control numbers: |num1|num2|...|numN
        unique_cns = []
        for cn in all_control_numbers:
            if cn and cn not in unique_cns:
                unique_cns.append(cn)
        page_numbers = "|" + "|".join(all_control_numbers) if all_control_numbers else ""

        return ProtocolRecord(
            form_number=str(page1_data.form_type),
            section_code=page1_data.section_code,
            rik_code=str(int(page1_data.rik_code)) if page1_data.rik_code else page1_data.rik_code,
            page_numbers=page_numbers,
            field5="",
            field6="",
            ballots_received=page1_data.ballots_received,
            voter_list_count=page2_data.voter_list_count if page2_data else None,
            additional_voters=page2_data.additional_voters if page2_data else None,
            voted_count=page2_data.voted_count if page2_data else None,
            unused_ballots=page2_data.unused_ballots if page2_data else None,
            invalid_ballots=page2_data.invalid_ballots if page2_data else None,
            paper_ballots=page2_data.paper_ballots_in_box if page2_data else None,
            invalid_votes=page2_data.invalid_votes if page2_data else None,
            no_support_votes_paper=page2_data.no_support_votes if page2_data else None,
            valid_votes_paper=(
                paper_votes.total_valid_paper_votes if paper_votes else None
            ),
            machine_ballots=(
                machine_votes.machine_ballots_in_box
                if is_machine_form and machine_votes
                else None
            ),
            no_support_votes_machine=(
                machine_votes.no_support_votes_machine
                if is_machine_form and machine_votes
                else None
            ),
            valid_votes_machine=(
                machine_votes.total_valid_machine_votes
                if is_machine_form and machine_votes
                else None
            ),
        )

    @staticmethod
    def _build_vote_record(
        page1_data,
        paper_votes,
        machine_votes,
        is_machine_form: bool,
    ) -> VoteRecord:
        """Aggregate paper and machine votes into a VoteRecord."""
        paper_map: dict[int, int] = {}
        if paper_votes:
            for v in paper_votes.votes:
                paper_map[v.party_number] = v.vote_count

        machine_map: dict[int, int] = {}
        if is_machine_form and machine_votes:
            for v in machine_votes.votes:
                machine_map[v.party_number] = v.vote_count

        # Collect all party numbers — use the full range 1..max found,
        # filling in 0 for parties not present in the HTML (CIK includes all slots)
        max_party = 0
        if paper_votes:
            for v in paper_votes.votes:
                if v.party_number > max_party:
                    max_party = v.party_number
        if is_machine_form and machine_votes:
            for v in machine_votes.votes:
                if v.party_number > max_party:
                    max_party = v.party_number

        party_votes: list[tuple[int, int, int, int]] = []
        for pn in range(1, max_party + 1):
            paper = paper_map.get(pn, 0)
            machine = machine_map.get(pn, 0) if is_machine_form else 0
            total = paper + machine
            party_votes.append((pn, total, paper, machine))

        return VoteRecord(
            form_number=str(page1_data.form_type),
            section_code=page1_data.section_code,
            rik_code=str(int(page1_data.rik_code)) if page1_data.rik_code else page1_data.rik_code,
            party_votes=party_votes,
        )

    @staticmethod
    def _build_preference_records(
        page1_data,
        paper_prefs,
        machine_prefs,
        is_machine_form: bool,
    ) -> list[PreferenceRecord]:
        """Combine paper and machine preferences into PreferenceRecords."""
        form_number = str(page1_data.form_type)
        section_code = page1_data.section_code

        # Build lookup: (party_number, candidate_number) -> paper_votes
        paper_map: dict[tuple[int, int], int] = {}
        if paper_prefs:
            for p in paper_prefs.preferences:
                key = (p.party_number, p.candidate_number)
                paper_map[key] = paper_map.get(key, 0) + p.vote_count

        # Build lookup: (party_number, candidate_number) -> machine_votes
        machine_map: dict[tuple[int, int], int] = {}
        if is_machine_form and machine_prefs:
            for p in machine_prefs.preferences:
                key = (p.party_number, p.candidate_number)
                machine_map[key] = machine_map.get(key, 0) + p.vote_count

        # Bez preferentsii: paper + machine
        paper_bez = paper_prefs.bez_preferentsii if paper_prefs else {}
        machine_bez = machine_prefs.bez_preferentsii if is_machine_form and machine_prefs else {}

        # Collect all party numbers seen
        all_party_nums: set[int] = set()
        if paper_prefs:
            for p in paper_prefs.preferences:
                all_party_nums.add(p.party_number)
        if is_machine_form and machine_prefs:
            for p in machine_prefs.preferences:
                all_party_nums.add(p.party_number)
        for pn in paper_bez:
            all_party_nums.add(pn)
        for pn in machine_bez:
            all_party_nums.add(pn)

        records: list[PreferenceRecord] = []
        for party_num in sorted(all_party_nums):
            # Bez line first
            p_bez = paper_bez.get(party_num, 0)
            m_bez = machine_bez.get(party_num, 0) if is_machine_form else 0
            records.append(PreferenceRecord(
                form_number=form_number,
                section_code=section_code,
                party_number=party_num,
                candidate_number="Без",
                total_votes=p_bez + m_bez,
                paper_votes=p_bez,
                machine_votes=m_bez,
            ))

            # Candidate lines — output all 22 slots (101-122)
            for cand_num in range(101, 123):
                paper = paper_map.get((party_num, cand_num), 0)
                machine = machine_map.get((party_num, cand_num), 0) if is_machine_form else 0
                total = paper + machine
                records.append(PreferenceRecord(
                    form_number=form_number,
                    section_code=section_code,
                    party_number=party_num,
                    candidate_number=str(cand_num),
                    total_votes=total,
                    paper_votes=paper,
                    machine_votes=machine,
                ))

        return records
