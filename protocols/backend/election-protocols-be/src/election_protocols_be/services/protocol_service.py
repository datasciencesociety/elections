"""Business logic for protocol operations."""

from __future__ import annotations

import base64
import json
import logging
import re
import tempfile
import time
from pathlib import Path
from typing import AsyncGenerator, Optional, Any

import fitz  # PyMuPDF
from fastapi import UploadFile
from google import genai
from google.genai import types
from openai import AsyncOpenAI
from pydantic import ValidationError

from election_protocols_be.models.protocol import Protocol
from election_protocols_be.models.response import CompareResult, ProcessResult
from election_protocols_be.utils.settings import get_settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JSON Schema Templates
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

_GEMINI_DIRECT_PROMPT = f"""Ти си експерт по изборни одити. Анализираш прикачения сканиран PDF протокол.

Ето празен JSON шаблон, който трябва да попълниш:
{json.dumps(_EMPTY_SCHEMA, indent=2)}

Ето схемата с описания на полетата:
{_SCHEMA_DESCRIPTION}

Инструкции:
1. Извлечи данните от прикачения PDF протокол и ги нанеси в JSON структурата.
2. Ако дадено число е задраскано, поправено или неразбираемо, върни -1.
3. Ако полето изобщо не присъства или не е намерено в протокола, остави го null.
4. Върни САМО валиден JSON без допълнителни обяснения, маркдаун блокове (```json) или друг текст."""

_CHANDRA_PROMPT = """OCR this image to HTML, arranged as layout blocks. Each layout block should be a div with the data-bbox attribute representing the bounding box of the block in x0 y0 x1 y1 format. Bboxes are normalized 0-1000. The data-label attribute is the label for the block in x0 y0 x1 y1 format.

Use the following labels: Caption, Footnote, Equation-Block, List-Group, Page-Header, Page-Footer, Image, Section-Header, Table, Text, Complex-Block, Code-Block, Form, Table-Of-Contents, Figure, Chemical-Block, Diagram, Bibliography, Blank-Page.

Only use these tags ['math', 'br', 'i', 'b', 'u', 'del', 'sup', 'sub', 'table', 'tr', 'td', 'p', 'th', 'div', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'input', 'a', 'span', 'img', 'hr', 'tbody', 'small', 'caption', 'strong', 'thead', 'big', 'code', 'chem'], and attributes ['class', 'colspan', 'rowspan', 'display', 'checked', 'type', 'border', 'value', 'style', 'href', 'alt', 'align', 'data-bbox', 'data-label'].
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_json_lenient(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        cleaned = re.sub(r",\s*([}\]])", r"\1", text)
        return json.loads(cleaned)

def _image_bytes_to_data_url(image_bytes: bytes, mime_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"

def _compare_scalar(label: str, gt_val, pred_val, errors: list, nulls: list) -> None:
    if gt_val is None and pred_val is None: return
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
            errors.append(f"{prefix}: extra party in PRED")
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
            if cn not in gt_prefs: errors.append(f"{lbl}: extra candidate")
            elif cn not in pred_prefs: nulls.append(f"{lbl}: missing in PRED, GT={gt_prefs[cn]}")
            elif gt_prefs[cn] != pred_prefs[cn]: errors.append(f"{lbl}: GT={gt_prefs[cn]}, PRED={pred_prefs[cn]}")

def _compare(gt: dict, pred: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    nulls: list[str] = []
    for key in ["sik_no", "voter_count", "additional_voter_count", "registered_votes"]:
        _compare_scalar(key, gt.get(key), pred.get(key), errors, nulls)
    gt_pb, pred_pb = gt.get("paper_ballots", {}), pred.get("paper_ballots", {})
    for key in ["total", "unused_ballots", "registered_vote", "invalid_out_of_the_box", "invalid_in_the_box", "support_noone", "total_valid_votes"]:
        _compare_scalar(f"paper_ballots.{key}", gt_pb.get(key), pred_pb.get(key), errors, nulls)
    _compare_votes("paper_ballots", gt_pb.get("votes", []), pred_pb.get("votes", []), errors, nulls)
    gt_mb, pred_mb = gt.get("machine_ballots", {}), pred.get("machine_ballots", {})
    for key in ["total_votes", "support_noone", "total_valid_votes"]:
        _compare_scalar(f"machine_ballots.{key}", gt_mb.get(key), pred_mb.get(key), errors, nulls)
    _compare_votes("machine_ballots", gt_mb.get("votes", []), pred_mb.get("votes", []), errors, nulls)
    return errors, nulls

def _score(gt: dict, pred: dict) -> dict:
    counters = [0, 0, 0]  # total, wrong, missing
    def count(gt_d: dict, pred_d: dict, keys: list) -> None:
        for k in keys:
            gv, pv = gt_d.get(k), pred_d.get(k)
            if gv is None: continue
            counters[0] += 1
            if pv is None: counters[2] += 1
            elif gv != pv: counters[1] += 1

    count(gt, pred, ["sik_no", "voter_count", "additional_voter_count", "registered_votes"])
    count(gt.get("paper_ballots", {}), pred.get("paper_ballots", {}), ["total", "unused_ballots", "registered_vote", "invalid_out_of_the_box", "invalid_in_the_box", "support_noone", "total_valid_votes"])
    count(gt.get("machine_ballots", {}), pred.get("machine_ballots", {}), ["total_votes", "support_noone", "total_valid_votes"])

    def count_votes(gt_votes: list, pred_votes: list) -> None:
        pby = {v["party_number"]: v for v in pred_votes}
        for gv in gt_votes:
            pv = pby.get(gv["party_number"], {})
            for k in ["votes", "no_preferences"]:
                gval = gv.get(k)
                if gval is None: continue
                counters[0] += 1
                pval = pv.get(k)
                if pval is None: counters[2] += 1
                elif gval != pval: counters[1] += 1
            gt_pr = {p["candidate_number"]: p["count"] for p in gv.get("preferences", [])}
            pred_pr = {p["candidate_number"]: p["count"] for p in pv.get("preferences", [])}
            for cn, gc in gt_pr.items():
                counters[0] += 1
                if cn not in pred_pr: counters[2] += 1
                elif pred_pr[cn] != gc: counters[1] += 1

    count_votes(gt.get("paper_ballots", {}).get("votes", []), pred.get("paper_ballots", {}).get("votes", []))
    count_votes(gt.get("machine_ballots", {}).get("votes", []), pred.get("machine_ballots", {}).get("votes", []))
    t, w, m = counters
    c = t - w - m
    return {"total": t, "correct": c, "wrong": w, "missing": m, "accuracy": round(100 * c / t, 1) if t else 0}


# ---------------------------------------------------------------------------
# Streaming OCR Logic
# ---------------------------------------------------------------------------

async def get_pdf_pages_fitz(pdf_bytes: bytes, dpi: int) -> list[bytes]:
    pages = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    doc = fitz.open("pdf", pdf_bytes)
    for i in range(len(doc)):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pages.append(pix.tobytes("png"))
    doc.close()
    return pages

async def chandra_ocr_page(client: AsyncOpenAI, model: str, png_bytes: bytes) -> str:
    image_url = _image_bytes_to_data_url(png_bytes)
    resp = await client.chat.completions.create(
        model=model,
        temperature=0,
        max_tokens=16384,
        messages=[
            {"role": "system", "content": "You convert document pages to accurate HTML."},
            {"role": "user", "content": [{"type": "text", "text": _CHANDRA_PROMPT}, {"type": "image_url", "image_url": {"url": image_url}}]}
        ]
    )
    return resp.choices[0].message.content.strip()

async def stream_process(
    uploaded_files: list[UploadFile],
    sik_type: str,
    ocr_mode: str,
    ground_truth_file: Optional[UploadFile] = None,
) -> AsyncGenerator[str, None]:
    """Yields JSON chunks with SSE format: 'data: {...}\n\n'."""
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        yield 'data: {"status":"error","msg":"GEMINI_API_KEY no config"}\n\n'
        return

    gclient = genai.Client(api_key=settings.GEMINI_API_KEY)
    is_html_upload = any(f.filename and f.filename.lower().endswith(".html") for f in uploaded_files)

    try:
        if ocr_mode == "gemini":
            pdf_file = uploaded_files[0]
            pdf_bytes = await pdf_file.read()
            yield 'data: {"status":"progress","msg":"Качване на PDF към Gemini..."}\n\n'
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, mode="wb") as tmp:
                tmp.write(pdf_bytes)
                tmp_path = Path(tmp.name)
            uploaded_file = None
            try:
                uploaded_file = gclient.files.upload(file=str(tmp_path))
                yield 'data: {"status":"progress","msg":"Анализиране на целия документ..."}\n\n'
                resp = gclient.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=[uploaded_file, _GEMINI_DIRECT_PROMPT],
                    config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0)
                )
                raw_ocr = _load_json_lenient(resp.text)
            finally:
                tmp_path.unlink(missing_ok=True)
                if uploaded_file:
                    try: gclient.files.delete(name=uploaded_file.name)
                    except Exception: pass

        elif ocr_mode == "chandra":
            current_json = dict(_EMPTY_SCHEMA)
            
            if is_html_upload:
                # User uploaded pre-processed HTML pages directly
                # Sort them naturally by page number if possible, or string sort
                def sort_key(f: UploadFile):
                    m = re.search(r"page_(\d+)", f.filename or "", re.IGNORECASE)
                    return int(m.group(1)) if m else f.filename
                
                html_files = sorted(uploaded_files, key=sort_key)
                yield f'data: {{"status":"progress","msg":"Получени са {len(html_files)} HTML страници."}}\n\n'
                
                for i, f in enumerate(html_files, start=1):
                    html_content = (await f.read()).decode("utf-8")
                    yield f'data: {{"status":"progress","msg":"Gemini анализ на {f.filename} ({i}/{len(html_files)})..."}}\n\n'
                    prompt = f"""Ти си експерт по изборни одити. Анализираш страница {i} от сканиран протокол, преобразуван в HTML чрез OCR.
Текущо частично попълнено JSON:\n{json.dumps(current_json, ensure_ascii=False, indent=2)}\nСхема:\n{_SCHEMA_DESCRIPTION}\n
HTML съдържание:\n{html_content}\n
Инструкции:
1. Попълни всички полета в JSON. НЕ изтривай вече попълнени данни (не-null).
2. За нови партийни записи в "votes" — добавяй ги.
3. Ако дадено число е задраскано, върни -1. Остави null ако не е намерено.
4. Върни само валиден JSON."""
                    
                    resp = gclient.models.generate_content(
                        model=settings.GEMINI_MODEL,
                        contents=[prompt],
                        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0)
                    )
                    try:
                        current_json = json.loads(resp.text)
                    except Exception:
                        pass # keep previous if fails
            else:
                pdf_file = uploaded_files[0]
                stem = Path(pdf_file.filename or "").stem
                
                # Check for cached pages from previous runs (great for demo)
                cache_dir = Path("/Users/vasilena.krazheva/Documents/Other/hackathon/elections/output_v2") / stem
                if cache_dir.exists() and cache_dir.is_dir() and any(cache_dir.iterdir()):
                    yield f'data: {{"status":"progress","msg":"Намерени са кеширани HTML страници за {stem}. Пропускаме Chandra съвръра!"}}\n\n'
                    
                    def sort_key_path(p: Path):
                        m = re.search(r"page_(\d+)", p.name, re.IGNORECASE)
                        return int(m.group(1)) if m else p.name
                        
                    html_files = sorted(cache_dir.glob("*.html"), key=sort_key_path)
                    for i, p in enumerate(html_files, start=1):
                        html_content = p.read_text(encoding="utf-8")
                        yield f'data: {{"status":"progress","msg":"Gemini анализ на кеширана страница {i}/{len(html_files)}..."}}\n\n'
                        prompt = f"""Ти си експерт по изборни одити. Анализираш страница {i} от сканиран протокол, преобразуван в HTML чрез OCR.
Текущо частично попълнено JSON:\n{json.dumps(current_json, ensure_ascii=False, indent=2)}\nСхема:\n{_SCHEMA_DESCRIPTION}\n
HTML съдържание:\n{html_content}\n
Инструкции:
1. Попълни всички полета в JSON. НЕ изтривай вече попълнени данни (не-null).
2. За нови партийни записи в "votes" — добавяй ги.
3. Ако дадено число е задраскано, върни -1. Остави null ако не е намерено.
4. Върни само валиден JSON."""
                        
                        resp = gclient.models.generate_content(
                            model=settings.GEMINI_MODEL,
                            contents=[prompt],
                            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0)
                        )
                        try:
                            current_json = json.loads(resp.text)
                        except Exception:
                            pass # keep previous if fails
                            
                else:
                    # Fallback to local chandra vLLM API processing
                    pdf_bytes = await pdf_file.read()
                    yield 'data: {"status":"progress","msg":"Няма кеширани файлове. Разделяне на PDF на страници..."}\n\n'
                    pages = await get_pdf_pages_fitz(pdf_bytes, settings.CHANDRA_DPI)
                    yield f'data: {{"status":"progress","msg":"Намерени са {len(pages)} страници."}}\n\n'

                    # Set max_retries=0 so it fails immediately if the Chandra server is not running
                    aclient = AsyncOpenAI(base_url=settings.CHANDRA_BASE_URL, api_key=settings.CHANDRA_API_KEY, timeout=120.0, max_retries=0)

                    for i, page_png in enumerate(pages, start=1):
                        yield f'data: {{"status":"progress","msg":"Chandra OCR на страница {i}/{len(pages)}..."}}\n\n'
                        try:
                            page_html = await chandra_ocr_page(aclient, settings.CHANDRA_MODEL, page_png)
                        except Exception as e:
                            if "Connection error" in str(e) or "connect" in str(e).lower():
                                msg = "Грешка при свързване с локален Chandra сървър. Моля, стартирайте сървъра."
                            else:
                                msg = f"Грешка в Chandra API: {str(e)}"
                            yield f'data: {{"status":"error","msg":"{msg}"}}\n\n'
                            return
                        
                        yield f'data: {{"status":"progress","msg":"Gemini анализ на страница {i}/{len(pages)}..."}}\n\n'
                        prompt = f"""Ти си експерт по изборни одити. Анализираш страница {i} от сканиран протокол, преобразуван в HTML чрез OCR.
Текущо частично попълнено JSON:\n{json.dumps(current_json, ensure_ascii=False, indent=2)}\nСхема:\n{_SCHEMA_DESCRIPTION}\n
HTML съдържание:\n{page_html}\n
Инструкции:
1. Попълни всички полета в JSON. НЕ изтривай вече попълнени данни (не-null).
2. За нови партийни записи в "votes" — добавяй ги.
3. Ако дадено число е задраскано, върни -1. Остави null ако не е намерено.
4. Върни само валиден JSON."""
                        
                        resp = gclient.models.generate_content(
                            model=settings.GEMINI_MODEL,
                            contents=[prompt],
                            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0)
                        )
                        try:
                            current_json = json.loads(resp.text)
                        except Exception:
                            pass # keep previous if fails
            
            raw_ocr = current_json
            
        else:
            yield 'data: {"status":"error","msg":"Invalid OCR mode"}\n\n'
            return

        yield 'data: {"status":"progress","msg":"Валидиране на данните..."}\n\n'

        ocr_for_val = dict(raw_ocr)
        ocr_for_val["sik_type"] = sik_type
        if isinstance(ocr_for_val.get("sik_no"), int):
            ocr_for_val["sik_no"] = str(ocr_for_val["sik_no"]).zfill(9)

        protocol = None
        val_errors = []
        try:
            protocol = Protocol.model_validate(ocr_for_val)
        except ValidationError as exc:
            val_errors = [f"{e['loc']}: {e['msg']}" for e in exc.errors()]

        comparison = None
        if ground_truth_file is not None:
            yield 'data: {"status":"progress","msg":"Сравняване с ground-truth..."}\n\n'
            gt_text = (await ground_truth_file.read()).decode("utf-8")
            gt = _load_json_lenient(gt_text)
            errs, nuls = _compare(gt, raw_ocr)
            sc = _score(gt, raw_ocr)
            comparison = CompareResult(score=sc, errors=errs, nulls=nuls)

        res = ProcessResult(
            raw_ocr=raw_ocr,
            protocol=protocol,
            validation_errors=val_errors,
            comparison=comparison
        )
        # Yield final result
        yield f'data: {{"status":"done", "result": {res.model_dump_json()}}}\n\n'

    except Exception as exc:
        log.exception("Stream pipeline failed")
        yield f'data: {{"status":"error","msg":"{str(exc)}"}}\n\n'
