"""
ocr_gemini_tests.py

Extract election protocol data from a directory of per-page HTML files
(produced by pdf_to_html.py) by iterating through each page and asking
Gemini to progressively fill in the JSON schema.

Usage:
    python ocr_gemini_tests.py <path_to_html_dir> [--output result.json]

Example:
    python ocr_gemini_tests.py ./elections/output_v2/122400005.0 --output 122400005.json
"""

import os
import re
import json
import argparse
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types


# ---------------------------------------------------------------------------
# JSON Schema (empty template)
# ---------------------------------------------------------------------------

EMPTY_SCHEMA = {
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
        "total_valid_votes": None
    },
    "machine_ballots": {
        "total_votes": None,
        "support_noone": None,
        "total_valid_votes": None,
        "votes": []
    }
}

SCHEMA_DESCRIPTION = """{
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


def sort_key(path: Path) -> int:
    """Extract the page number from filenames like 'doc_page_3.html'."""
    match = re.search(r"page_(\d+)", path.name, re.IGNORECASE)
    return int(match.group(1)) if match else 0


def get_page_files(html_dir: Path) -> list[Path]:
    """Return HTML files sorted by page number."""
    files = sorted(
        [f for f in html_dir.iterdir() if f.suffix.lower() == ".html"],
        key=sort_key
    )
    if not files:
        raise ValueError(f"No HTML files found in: {html_dir}")
    return files


def process_page(client, current_json: dict, page_html: str, page_num: int, model: str) -> dict:
    """
    Send a single page's HTML content to Gemini, along with the accumulated
    JSON so far, and ask it to fill in any new fields it can find.
    """
    prompt = f"""Ти си експерт по изборни одити. Анализираш страница {page_num} от сканиран протокол, преобразуван в HTML чрез OCR.

Ето текущото частично попълнено JSON (null = все още не е намерено):
{json.dumps(current_json, ensure_ascii=False, indent=2)}

Ето схемата с описания на полетата:
{SCHEMA_DESCRIPTION}

Ето HTML съдържанието на страница {page_num}:
--- НАЧАЛО НА СТРАНИЦАТА ---
{page_html}
--- КРАЙ НА СТРАНИЦАТА ---

Инструкции:
1. Попълни всички полета в JSON, ако ги намираш на тази страница.
2. НЕ изтривай вече попълнени данни (не-null стойности) — само ги запазвай.
3. За нови партийни записи в "votes" масивите — добавяй ги, не заместявай.
4. Ако дадено число е задраскано или неразбираемо, върни -1.
5. Ако полето не е намерено на тази страница, остави го null.
6. Върни само валиден JSON без обяснения."""

    response = client.models.generate_content(
        model=model,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0
        )
    )

    try:
        return json.loads(response.text)
    except json.JSONDecodeError as e:
        print(f"  [WARN] Page {page_num}: Failed to parse JSON response: {e}")
        print(f"  [WARN] Raw response: {response.text[:300]}")
        return current_json  # Keep previous state on failure


def run_extraction(html_dir: Path, output_path: Path | None = None, model: str = "gemini-2.5-flash"):
    client = genai.Client()

    page_files = get_page_files(html_dir)
    print(f"Found {len(page_files)} page(s) in: {html_dir}")

    current_json = EMPTY_SCHEMA.copy()

    for i, page_file in enumerate(page_files, start=1):
        page_num = sort_key(page_file)
        print(f"\n[{i}/{len(page_files)}] Processing page {page_num}: {page_file.name}")

        page_html = page_file.read_text(encoding="utf-8")
        current_json = process_page(client, current_json, page_html, page_num, model)

        print(f"  Done. sik_no={current_json.get('sik_no')}, "
              f"paper_votes={len(current_json.get('paper_ballots', {}).get('votes', []))}, "
              f"machine_votes={len(current_json.get('machine_ballots', {}).get('votes', []))}")

    print("\n--- Final Extracted Protocol Data ---")
    result_json = json.dumps(current_json, ensure_ascii=False, indent=2)
    print(result_json)

    if output_path:
        output_path.write_text(result_json, encoding="utf-8")
        print(f"\nSaved to: {output_path}")

    return current_json


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Extract election protocol data from per-page HTML files using Gemini."
    )
    parser.add_argument(
        "html_dir",
        nargs="?",
        default="elections/data/chandra_output_per_page",
        help="Directory containing per-page HTML files (e.g. output from pdf_to_html.py)."
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Path to save the final JSON result (optional)."
    )
    parser.add_argument(
        "--model", "-m",
        default="gemini-2.5-flash",
        help="Model to use for extraction."
    )
    args = parser.parse_args()

    html_dir = Path(args.html_dir).expanduser().resolve()
    if not html_dir.is_dir():
        print(f"Error: Directory not found: {html_dir}")
        return

    output_path = Path(args.output).expanduser().resolve() if args.output else None

    run_extraction(html_dir, output_path, args.model)


if __name__ == "__main__":
    main()
