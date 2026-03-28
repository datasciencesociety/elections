"""Business logic for protocol operations.

Uses the same Gemini approach as ocr_reason_gemini.py (direct PDF upload to
Google Files API + single-pass inference) — no intermediate disk writes.
"""

from __future__ import annotations

import json
import logging
import re
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import UploadFile
from google import genai
from google.genai import types
from pydantic import ValidationError

from election_protocols_be.models.protocol import Protocol
from election_protocols_be.models.response import CompareResult, ProcessResult
from election_protocols_be.utils.settings import get_settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JSON Schema (same as ocr_reason_gemini.py)
# ---------------------------------------------------------------------------

_EMPTY_SCHEMA = {
    "sik_no": None,
    "voter_count": None,
    "additional_voter_count": None,
    "registered_votes": None,
    "paper_ballots": {
        "total": None,
        "unused_ballots": None,
        "registered_vote": None,
        "invalid_out_of_the_box": None,
        "invalid_in_the_box": None,
        "support_noone": None,
        "votes": [],
        "total_valid_votes": None,
    },
    "machine_ballots": {
        "total_votes": None,
        "support_noone": None,
        "total_valid_votes": None,
        "votes": [],
    },
}

_SCHEMA_DESCRIPTION = """{
  "sik_no": int,                        // the topmost number in the squares
  "voter_count": int,                   // брой на избирателите - точка 1)
  "additional_voter_count": int,        // избиратели под чертата - точка 2)
  "registered_votes": int,              // избирателите според положените подписи - точка 3)
  "paper_ballots": {
    "total": int,                       // брой на получените бюлетини - точка А
    "unused_ballots": int,              // точка 4а
    "registered_vote": int,            // намерените бюлетини в кутията - точка 5)
    "invalid_out_of_the_box": int,     // недействителни бюлетини за образци - точка 4б
    "invalid_in_the_box": int,         // недействителни бюлетини в кутията - точка 6)
    "support_noone": int,
    "votes": [
      {
        "party_number": int,            // номера на партията
        "votes": int,                   // гласове без преференции - точка 8
        "preferences": [               // точка 10
          { "candidate_number": int, "count": int }
        ],
        "no_preferences": int          // без преференция - точка 10
      }
    ],
    "total_valid_votes": int           // общ брой действителни гласове - точка 9
  },
  "machine_ballots": {
    "total_votes": int,                // машинно гласуване - точка 11
    "support_noone": int,             // не подкрепям никого - точка 12
    "total_valid_votes": int,         // точка 14
    "votes": [
      {
        "party_number": int,           // номер на партията - точка 13
        "votes": int,                  // действителни гласове - точка 13
        "preferences": [              // точка 15
          { "candidate_number": int, "count": int }
        ],
        "no_preferences": int
      }
    ]
  }
}"""

_PROMPT = f"""Ти си експерт по изборни одити. Анализираш прикачения сканиран PDF протокол.

Ето празен JSON шаблон, който трябва да попълниш:
{json.dumps(_EMPTY_SCHEMA, indent=2)}

Ето схемата с описания на полетата:
{_SCHEMA_DESCRIPTION}

Инструкции:
1. Извлечи данните от прикачения PDF протокол и ги нанеси в JSON структурата.
2. Ако дадено число е задраскано, поправено или неразбираемо, върни -1.
3. Ако полето изобщо не присъства или не е намерено в протокола, остави го null.
4. Върни САМО валиден JSON без допълнителни обяснения, маркдаун блокове (```json) или друг текст."""


# ---------------------------------------------------------------------------
# Helpers: compare logic (from compare_results.py)
# ---------------------------------------------------------------------------

def _load_json_lenient(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        cleaned = re.sub(r",\s*([}\]])", r"\1", text)
        return json.loads(cleaned)


def _compare_scalar(label: str, gt_val, pred_val, errors: list, nulls: list) -> None:
    if gt_val is None and pred_val is None:
        return
    if pred_val is None:
        nulls.append(f"{label}: GT={gt_val}, PRED=null")
        return
    if gt_val != pred_val:
        diff = pred_val - gt_val if isinstance(gt_val, (int, float)) and isinstance(pred_val, (int, float)) else "?"
        errors.append(f"{label}: GT={gt_val}, PRED={pred_val} (diff={diff})")


def _compare_votes(section: str, gt_votes: list, pred_votes: list, errors: list, nulls: list) -> None:
    pred_by_party = {v["party_number"]: v for v in pred_votes}
    gt_by_party = {v["party_number"]: v for v in gt_votes}
    for pn in sorted(set(gt_by_party) | set(pred_by_party)):
        prefix = f"{section}.votes[party={pn}]"
        if pn not in gt_by_party:
            errors.append(f"{prefix}: extra party in PRED (not in GT)")
            continue
        if pn not in pred_by_party:
            errors.append(f"{prefix}: missing party in PRED")
            continue
        gt_v, pred_v = gt_by_party[pn], pred_by_party[pn]
        _compare_scalar(f"{prefix}.votes", gt_v.get("votes"), pred_v.get("votes"), errors, nulls)
        _compare_scalar(f"{prefix}.no_preferences", gt_v.get("no_preferences"), pred_v.get("no_preferences"), errors, nulls)
        gt_prefs = {p["candidate_number"]: p["count"] for p in gt_v.get("preferences", [])}
        pred_prefs = {p["candidate_number"]: p["count"] for p in pred_v.get("preferences", [])}
        for cn in sorted(set(gt_prefs) | set(pred_prefs)):
            lbl = f"{prefix}.preferences[cand={cn}].count"
            if cn not in gt_prefs:
                errors.append(f"{lbl}: extra candidate in PRED")
            elif cn not in pred_prefs:
                nulls.append(f"{lbl}: missing in PRED, GT={gt_prefs[cn]}")
            elif gt_prefs[cn] != pred_prefs[cn]:
                errors.append(f"{lbl}: GT={gt_prefs[cn]}, PRED={pred_prefs[cn]}")


def _compare(gt: dict, pred: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    nulls: list[str] = []
    for key in ["sik_no", "voter_count", "additional_voter_count", "registered_votes"]:
        _compare_scalar(key, gt.get(key), pred.get(key), errors, nulls)
    gt_pb, pred_pb = gt.get("paper_ballots", {}), pred.get("paper_ballots", {})
    for key in ["total", "unused_ballots", "registered_vote", "invalid_out_of_the_box",
                "invalid_in_the_box", "support_noone", "total_valid_votes"]:
        _compare_scalar(f"paper_ballots.{key}", gt_pb.get(key), pred_pb.get(key), errors, nulls)
    _compare_votes("paper_ballots", gt_pb.get("votes", []), pred_pb.get("votes", []), errors, nulls)
    gt_mb, pred_mb = gt.get("machine_ballots", {}), pred.get("machine_ballots", {})
    for key in ["total_votes", "support_noone", "total_valid_votes"]:
        _compare_scalar(f"machine_ballots.{key}", gt_mb.get(key), pred_mb.get(key), errors, nulls)
    _compare_votes("machine_ballots", gt_mb.get("votes", []), pred_mb.get("votes", []), errors, nulls)
    return errors, nulls


def _score(gt: dict, pred: dict) -> dict:
    # Use a mutable list [total, wrong, missing] to avoid nonlocal mutation issues
    counters = [0, 0, 0]  # [total, wrong, missing]

    def count(gt_d: dict, pred_d: dict, keys: list) -> None:
        for k in keys:
            gv, pv = gt_d.get(k), pred_d.get(k)
            if gv is None:
                continue
            counters[0] += 1
            if pv is None:
                counters[2] += 1
            elif gv != pv:
                counters[1] += 1

    count(gt, pred, ["sik_no", "voter_count", "additional_voter_count", "registered_votes"])
    count(gt.get("paper_ballots", {}), pred.get("paper_ballots", {}),
          ["total", "unused_ballots", "registered_vote", "invalid_out_of_the_box",
           "invalid_in_the_box", "support_noone", "total_valid_votes"])
    count(gt.get("machine_ballots", {}), pred.get("machine_ballots", {}),
          ["total_votes", "support_noone", "total_valid_votes"])

    def count_votes(gt_votes: list, pred_votes: list) -> None:
        pby = {v["party_number"]: v for v in pred_votes}
        for gv in gt_votes:
            pv = pby.get(gv["party_number"], {})
            for k in ["votes", "no_preferences"]:
                gval = gv.get(k)
                if gval is None:
                    continue
                counters[0] += 1
                pval = pv.get(k)
                if pval is None:
                    counters[2] += 1
                elif gval != pval:
                    counters[1] += 1
            gt_pr = {p["candidate_number"]: p["count"] for p in gv.get("preferences", [])}
            pred_pr = {p["candidate_number"]: p["count"] for p in pv.get("preferences", [])}
            for cn, gc in gt_pr.items():
                counters[0] += 1
                if cn not in pred_pr:
                    counters[2] += 1
                elif pred_pr[cn] != gc:
                    counters[1] += 1

    count_votes(gt.get("paper_ballots", {}).get("votes", []), pred.get("paper_ballots", {}).get("votes", []))
    count_votes(gt.get("machine_ballots", {}).get("votes", []), pred.get("machine_ballots", {}).get("votes", []))

    total, wrong, missing = counters
    correct = total - wrong - missing
    return {"total": total, "correct": correct, "wrong": wrong, "missing": missing,
            "accuracy": round(100 * correct / total, 1) if total else 0}


# ---------------------------------------------------------------------------
# Main service function
# ---------------------------------------------------------------------------

async def process(
    pdf_file: UploadFile,
    sik_type: str,
    ground_truth_file: Optional[UploadFile] = None,
) -> ProcessResult:
    """Run Gemini OCR on a PDF, validate, and optionally compare with GT."""
    settings = get_settings()

    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    # 1. Run Gemini OCR -------------------------------------------------------
    pdf_bytes = await pdf_file.read()
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    uploaded_file = None

    # Write bytes to a temp file so the Files API can upload it
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, mode="wb") as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        uploaded_file = client.files.upload(file=str(tmp_path))
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[uploaded_file, _PROMPT],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )
        raw_ocr: dict = _load_json_lenient(response.text)
    finally:
        tmp_path.unlink(missing_ok=True)
        if uploaded_file:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                log.warning("Could not delete uploaded file %s from Gemini", uploaded_file.name)

    log.info("Gemini OCR returned %d top-level keys", len(raw_ocr))

    # 2. Normalise sik_no (Gemini returns int, Protocol expects 9-digit string)
    ocr_for_validation = dict(raw_ocr)
    ocr_for_validation["sik_type"] = sik_type
    if isinstance(ocr_for_validation.get("sik_no"), int):
        ocr_for_validation["sik_no"] = str(ocr_for_validation["sik_no"]).zfill(9)

    # 3. Validate with Pydantic Protocol model --------------------------------
    protocol: Optional[Protocol] = None
    validation_errors: list[str] = []
    try:
        protocol = Protocol.model_validate(ocr_for_validation)
    except ValidationError as exc:
        validation_errors = [f"{e['loc']}: {e['msg']}" for e in exc.errors()]
        log.info("Protocol validation failed with %d errors", len(validation_errors))

    # 4. Compare with ground truth (if provided) ------------------------------
    comparison: Optional[CompareResult] = None
    if ground_truth_file is not None:
        gt_text = (await ground_truth_file.read()).decode("utf-8")
        gt: dict = _load_json_lenient(gt_text)
        errors, nulls = _compare(gt, raw_ocr)
        score = _score(gt, raw_ocr)
        comparison = CompareResult(score=score, errors=errors, nulls=nulls)

    return ProcessResult(
        raw_ocr=raw_ocr,
        protocol=protocol,
        validation_errors=validation_errors,
        comparison=comparison,
    )
