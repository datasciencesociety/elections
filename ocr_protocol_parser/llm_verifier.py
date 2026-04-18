"""LLM-based post-parse verification for OCR Protocol Parser.

Sends raw HTML of individual pages (never multiple pages combined) with
compact prompts asking the LLM to extract specific fields. On any API
error the original parsed data is returned unchanged.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .models import (
    LLMVerifierConfig,
    MachinePreferencesData,
    MachineVotesData,
    Page1Data,
    Page2Data,
    PaperPreferencesData,
    PaperVotesData,
    PreferenceEntry,
    VoteEntry,
)

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You are an OCR verification assistant for Bulgarian election protocols. "
    "You receive the raw HTML of ONE page from an OCR-ed protocol and values "
    "extracted by a conventional parser. Verify each value against the HTML "
    "and return corrected values as JSON. Only change values you are confident "
    "are wrong based on the HTML content."
)


class LLMVerifier:
    """Verify and correct OCR-extracted data using an LLM."""

    def __init__(self, config: LLMVerifierConfig) -> None:
        self.config = config
        import openai
        self._client = openai.OpenAI(
            api_key=config.api_key,
            base_url=config.api_base_url,
            timeout=config.timeout,
        )

    def _call_llm(self, user_prompt: str) -> dict:
        """Call LLM with a single-page prompt. Returns parsed JSON dict."""
        response = self._client.chat.completions.create(
            model=self.config.model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)

    @staticmethod
    def _log_discrepancy(field: str, old: Any, new: Any) -> None:
        logger.info("LLM correction: %s: %r -> %r", field, old, new)

    @staticmethod
    def _safe_int(value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None

    # ------------------------------------------------------------------
    # Page 1
    # ------------------------------------------------------------------

    def verify_page1(self, raw_html: str, parsed: Page1Data) -> Page1Data:
        try:
            prompt = (
                "Page 1 of election protocol.\n\n"
                f"## HTML\n{raw_html}\n\n"
                "## Conventional extraction\n"
                f"form_type: {parsed.form_type}\n"
                f"form_number: {parsed.form_number}\n"
                f"section_code: {parsed.section_code}\n"
                f"rik_code: {parsed.rik_code}\n"
                f"ballots_received: {parsed.ballots_received}\n\n"
                "Return JSON: {form_type, form_number, section_code, rik_code, ballots_received}"
            )
            r = self._call_llm(prompt)
            corrected = Page1Data(
                control_number=parsed.control_number,
                form_type=int(r.get("form_type", parsed.form_type)),
                form_number=str(r.get("form_number", parsed.form_number)),
                section_code=str(r.get("section_code", parsed.section_code)),
                rik_code=str(r.get("rik_code", parsed.rik_code)),
                ballots_received=self._safe_int(r.get("ballots_received", parsed.ballots_received)),
            )
            for f in ("form_type", "form_number", "section_code", "rik_code", "ballots_received"):
                if getattr(parsed, f) != getattr(corrected, f):
                    self._log_discrepancy(f, getattr(parsed, f), getattr(corrected, f))
            return corrected
        except Exception:
            logger.warning("LLM verification failed for page 1", exc_info=True)
            return parsed

    # ------------------------------------------------------------------
    # Page 2
    # ------------------------------------------------------------------

    _P2_FIELDS = (
        "voter_list_count", "additional_voters", "voted_count",
        "unused_ballots", "invalid_ballots", "paper_ballots_in_box",
        "invalid_votes", "no_support_votes",
    )

    def verify_page2(self, raw_html: str, parsed: Page2Data) -> Page2Data:
        try:
            lines = "\n".join(f"  {f}: {getattr(parsed, f)}" for f in self._P2_FIELDS)
            prompt = (
                "Page 2 — voter list and ballot data.\n\n"
                f"## HTML\n{raw_html}\n\n"
                f"## Conventional extraction\n{lines}\n\n"
                "Return JSON with these 8 keys (all int or null)."
            )
            r = self._call_llm(prompt)
            kwargs: dict[str, Any] = {"control_number": parsed.control_number}
            for f in self._P2_FIELDS:
                old = getattr(parsed, f)
                new = self._safe_int(r.get(f, old))
                if old != new:
                    self._log_discrepancy(f, old, new)
                kwargs[f] = new
            return Page2Data(**kwargs)
        except Exception:
            logger.warning("LLM verification failed for page 2", exc_info=True)
            return parsed

    # ------------------------------------------------------------------
    # Votes — verify one page at a time
    # ------------------------------------------------------------------

    def _verify_vote_page(
        self, raw_html: str, votes: list[VoteEntry], page_label: str,
    ) -> list[VoteEntry]:
        """Verify vote entries from a single page against its HTML."""
        vote_lines = "\n".join(f"  {v.party_number}: {v.vote_count}" for v in votes)
        prompt = (
            f"{page_label} — party vote distribution.\n\n"
            f"## HTML\n{raw_html}\n\n"
            f"## Conventional extraction (party: votes)\n{vote_lines}\n\n"
            'Return JSON: {{"votes": [{{"party_number": int, "vote_count": int}}, ...]}}'
        )
        r = self._call_llm(prompt)
        new_votes = [
            VoteEntry(int(v["party_number"]), int(v["vote_count"]))
            for v in r.get("votes", [])
        ]
        if not new_votes:
            return votes
        old_map = {v.party_number: v.vote_count for v in votes}
        for v in new_votes:
            old = old_map.get(v.party_number)
            if old is not None and old != v.vote_count:
                self._log_discrepancy(f"{page_label}_party_{v.party_number}", old, v.vote_count)
        return new_votes

    def verify_votes(
        self, raw_html_pages: list[str], parsed: PaperVotesData,
    ) -> PaperVotesData:
        """Verify paper votes page by page."""
        try:
            # Split votes by page — we don't know the exact split, so verify
            # all votes against each page and let the LLM figure it out.
            # For 2 pages: page 3 has first batch, page 4 has second + total.
            all_votes = list(parsed.votes)
            new_votes: list[VoteEntry] = []

            for i, html in enumerate(raw_html_pages):
                page_num = 3 + i
                # Verify all remaining votes against this page
                corrected = self._verify_vote_page(
                    html, all_votes, f"Paper votes page {page_num}"
                )
                new_votes = corrected

            # Verify total from last page
            new_total = parsed.total_valid_paper_votes
            if raw_html_pages:
                try:
                    prompt = (
                        f"Paper votes page {3 + len(raw_html_pages) - 1} — extract total.\n\n"
                        f"## HTML\n{raw_html_pages[-1]}\n\n"
                        f"## Conventional total: {parsed.total_valid_paper_votes}\n\n"
                        'Return JSON: {{"total_valid_paper_votes": int_or_null}}'
                    )
                    r = self._call_llm(prompt)
                    t = self._safe_int(r.get("total_valid_paper_votes", parsed.total_valid_paper_votes))
                    if t != parsed.total_valid_paper_votes:
                        self._log_discrepancy("total_valid_paper_votes", parsed.total_valid_paper_votes, t)
                    new_total = t
                except Exception:
                    pass

            return PaperVotesData(
                control_numbers=parsed.control_numbers,
                votes=new_votes if new_votes else parsed.votes,
                total_valid_paper_votes=new_total,
            )
        except Exception:
            logger.warning("LLM verification failed for paper votes", exc_info=True)
            return parsed

    def verify_machine_votes(
        self, raw_html_pages: list[str], parsed: MachineVotesData,
    ) -> MachineVotesData:
        """Verify machine votes page by page."""
        try:
            all_votes = list(parsed.votes)
            new_votes: list[VoteEntry] = []

            for i, html in enumerate(raw_html_pages):
                page_num = 8 + i
                corrected = self._verify_vote_page(
                    html, all_votes, f"Machine votes page {page_num}"
                )
                new_votes = corrected

            new_total = parsed.total_valid_machine_votes
            if raw_html_pages:
                try:
                    prompt = (
                        f"Machine votes page {8 + len(raw_html_pages) - 1} — extract total.\n\n"
                        f"## HTML\n{raw_html_pages[-1]}\n\n"
                        f"## Conventional total: {parsed.total_valid_machine_votes}\n\n"
                        'Return JSON: {{"total_valid_machine_votes": int_or_null}}'
                    )
                    r = self._call_llm(prompt)
                    t = self._safe_int(r.get("total_valid_machine_votes", parsed.total_valid_machine_votes))
                    if t != parsed.total_valid_machine_votes:
                        self._log_discrepancy("total_valid_machine_votes", parsed.total_valid_machine_votes, t)
                    new_total = t
                except Exception:
                    pass

            return MachineVotesData(
                control_numbers=parsed.control_numbers,
                votes=new_votes if new_votes else parsed.votes,
                machine_ballots_in_box=parsed.machine_ballots_in_box,
                no_support_votes_machine=parsed.no_support_votes_machine,
                total_valid_machine_votes=new_total,
            )
        except Exception:
            logger.warning("LLM verification failed for machine votes", exc_info=True)
            return parsed

    # ------------------------------------------------------------------
    # Preferences — verify one page at a time, per-party within each page
    # ------------------------------------------------------------------

    def _verify_preference_page(
        self,
        raw_html: str,
        prefs: list[PreferenceEntry],
        bez: dict[int, int],
        page_label: str,
    ) -> tuple[list[PreferenceEntry], dict[int, int]]:
        """Verify preferences from a single page against its HTML.

        Groups by party and sends one LLM call per party with non-zero votes.
        """
        by_party: dict[int, list[PreferenceEntry]] = {}
        for p in prefs:
            by_party.setdefault(p.party_number, []).append(p)

        new_prefs: list[PreferenceEntry] = []
        new_bez = dict(bez)

        for party_num in sorted(by_party):
            party_prefs = by_party[party_num]
            bez_val = bez.get(party_num, 0)

            # Skip all-zero parties
            if all(p.vote_count == 0 for p in party_prefs) and bez_val == 0:
                new_prefs.extend(party_prefs)
                continue

            nonzero = [(p.candidate_number, p.vote_count) for p in party_prefs if p.vote_count > 0]
            nonzero_str = "; ".join(f"{cn}:{vc}" for cn, vc in nonzero) if nonzero else "all zero"

            prompt = (
                f"{page_label}, party {party_num} preferences.\n\n"
                f"## HTML\n{raw_html}\n\n"
                f"## Conventional extraction\n"
                f"  Без преференции: {bez_val}\n"
                f"  Non-zero candidates (num:votes): {nonzero_str}\n"
                f"  Total candidates: {len(party_prefs)}\n\n"
                'Return JSON: {{"bez": int, "corrections": [{{"candidate_number": int, "vote_count": int}}, ...]}}\n'
                "Only include candidates in corrections if their value needs changing."
            )
            try:
                r = self._call_llm(prompt)
                new_bez_val = self._safe_int(r.get("bez", bez_val))
                if new_bez_val is not None and new_bez_val != bez_val:
                    self._log_discrepancy(f"{page_label}_party_{party_num}_bez", bez_val, new_bez_val)
                    new_bez[party_num] = new_bez_val

                corrections = {
                    int(c["candidate_number"]): int(c["vote_count"])
                    for c in r.get("corrections", [])
                }
                for p in party_prefs:
                    if p.candidate_number in corrections:
                        new_vc = corrections[p.candidate_number]
                        if new_vc != p.vote_count:
                            self._log_discrepancy(
                                f"{page_label}_party_{party_num}_cand_{p.candidate_number}",
                                p.vote_count, new_vc,
                            )
                        new_prefs.append(PreferenceEntry(party_num, p.candidate_number, new_vc))
                    else:
                        new_prefs.append(p)
            except Exception:
                logger.warning("LLM failed for %s party %d, keeping conventional", page_label, party_num)
                new_prefs.extend(party_prefs)

        return new_prefs, new_bez

    def verify_preferences(
        self, raw_html_pages: list[str], parsed: PaperPreferencesData,
    ) -> PaperPreferencesData:
        """Verify paper preferences page by page."""
        try:
            prefs = list(parsed.preferences)
            bez = dict(parsed.bez_preferentsii)

            for i, html in enumerate(raw_html_pages):
                page_num = 5 + i
                prefs, bez = self._verify_preference_page(
                    html, prefs, bez, f"Paper prefs page {page_num}"
                )

            return PaperPreferencesData(
                control_numbers=parsed.control_numbers,
                preferences=prefs,
                bez_preferentsii=bez,
            )
        except Exception:
            logger.warning("LLM verification failed for paper preferences", exc_info=True)
            return parsed

    def verify_machine_preferences(
        self, raw_html_pages: list[str], parsed: MachinePreferencesData,
    ) -> MachinePreferencesData:
        """Verify machine preferences page by page."""
        try:
            prefs = list(parsed.preferences)
            bez = dict(parsed.bez_preferentsii)

            for i, html in enumerate(raw_html_pages):
                page_num = 10 + i
                prefs, bez = self._verify_preference_page(
                    html, prefs, bez, f"Machine prefs page {page_num}"
                )

            return MachinePreferencesData(
                control_numbers=parsed.control_numbers,
                preferences=prefs,
                bez_preferentsii=bez,
            )
        except Exception:
            logger.warning("LLM verification failed for machine preferences", exc_info=True)
            return parsed
