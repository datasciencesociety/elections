#!/usr/bin/env python3
"""
pdf_to_html.py

Convert PDF files to HTML using a hosted Chandra OCR model behind a
vLLM OpenAI-compatible API.

Example:
    python pdf_to_html.py \
        --input ./docs/sample.pdf \
        --output-dir ./out \
        --base-url http://localhost:8000/v1 \
        --model datalab-to/chandra-ocr-2

Dependencies:
    pip install openai pymupdf

Notes:
- This script sends each PDF page separately to reduce context pressure.
- It saves both a combined HTML file and individual per-page HTML files.
"""

from __future__ import annotations

import argparse
import base64
import logging
import os
import sys
import time
from pathlib import Path
from typing import Iterable, List

import fitz  # PyMuPDF
from openai import OpenAI


DEFAULT_HTML_PROMPT = """You are an OCR-to-HTML engine.

Extract the page faithfully into clean, semantic HTML.
Rules:
- Preserve headings (h1, h2, etc.), paragraphs (p), lists (ul, ol, li), and tables (table, tr, td).
- Preserve reading order.
- Do not add explanations or commentary.
- Do not wrap the output in markdown code fences.
- Keep page content only.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert PDF files to HTML using hosted Chandra OCR."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to a PDF file or a folder containing PDFs.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Folder where .html files will be written.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("CHANDRA_BASE_URL", "http://localhost:8000/v1"),
        help="OpenAI-compatible base URL for vLLM, e.g. http://localhost:8000/v1",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("OPENAI_API_KEY", "EMPTY"),
        help="API key for the endpoint.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("CHANDRA_MODEL", "datalab-to/chandra-ocr-2"),
        help="Model name served by vLLM.",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=200,
        help="Render DPI for PDF pages. 180-220 is usually a good range.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Retries per page on request failure.",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=2.0,
        help="Sleep between retries.",
    )
    parser.add_argument(
        "--prompt",
        default=DEFAULT_HTML_PROMPT,
        help="OCR instruction prompt.",
    )
    return parser.parse_args()


def find_pdfs(input_path: Path) -> List[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() != ".pdf":
            raise ValueError(f"Input file is not a PDF: {input_path}")
        return [input_path]

    if input_path.is_dir():
        pdfs = sorted(p for p in input_path.rglob("*.pdf") if p.is_file())
        if not pdfs:
            raise ValueError(f"No PDF files found in directory: {input_path}")
        return pdfs

    raise FileNotFoundError(f"Input path does not exist: {input_path}")


def image_bytes_to_data_url(image_bytes: bytes, mime_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def render_pdf_pages(pdf_path: Path, dpi: int) -> Iterable[bytes]:
    """
    Yields PNG bytes for each page.
    """
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    with fitz.open(pdf_path) as doc:
        for page_index in range(len(doc)):
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            yield pix.tobytes("png")


def extract_page_html(
    client: OpenAI,
    model: str,
    page_png_bytes: bytes,
    prompt: str,
    max_retries: int,
    sleep_seconds: float,
) -> str:
    image_url = image_bytes_to_data_url(page_png_bytes, mime_type="image/png")
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=model,
                temperature=0,
                messages=[
                    {
                        "role": "system",
                        "content": "You convert document pages to accurate HTML.",
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    },
                ],
            )

            text = response.choices[0].message.content
            if not text or not text.strip():
                raise RuntimeError("Empty response from model.")

            return text.strip()

        except Exception as exc:
            last_error = exc
            logging.warning("Page request failed (attempt %s/%s): %s", attempt, max_retries, exc)
            if attempt < max_retries:
                time.sleep(sleep_seconds)

    raise RuntimeError(f"All retries failed. Last error: {last_error}")


def convert_pdf_to_html(
    client: OpenAI,
    pdf_path: Path,
    output_dir: Path,
    model: str,
    dpi: int,
    prompt: str,
    max_retries: int,
    sleep_seconds: float,
) -> Path:
    logging.info("Processing PDF: %s", pdf_path)

    # Create directory for individual pages
    pages_dir = output_dir / f"{pdf_path.stem}_pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    page_contents: List[str] = []

    for i, page_png in enumerate(render_pdf_pages(pdf_path, dpi=dpi), start=1):
        logging.info("  OCR page %d", i)
        html = extract_page_html(
            client=client,
            model=model,
            page_png_bytes=page_png,
            prompt=prompt,
            max_retries=max_retries,
            sleep_seconds=sleep_seconds,
        )
        
        # Save individual page
        page_path = pages_dir / f"page_{i}.html"
        page_path.write_text(html, encoding="utf-8")
        
        page_contents.append(f"<!-- page {i} -->\n{html}")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{pdf_path.stem}.html"
    output_text = "\n\n".join(page_contents).strip() + "\n"
    output_path.write_text(output_text, encoding="utf-8")

    logging.info("Saved Combined HTML: %s", output_path)
    logging.info("Saved Individual Pages to: %s", pages_dir)
    return output_path


def main() -> int:
    args = parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    try:
        pdfs = find_pdfs(input_path)
    except Exception as exc:
        logging.error("%s", exc)
        return 1

    client = OpenAI(
        base_url=args.base_url,
        api_key=args.api_key,
        timeout=120.0,
    )

    failures: List[tuple[Path, str]] = []

    for pdf_path in pdfs:
        try:
            convert_pdf_to_html(
                client=client,
                pdf_path=pdf_path,
                output_dir=output_dir,
                model=args.model,
                dpi=args.dpi,
                prompt=args.prompt,
                max_retries=args.max_retries,
                sleep_seconds=args.sleep_seconds,
            )
        except Exception as exc:
            logging.exception("Failed to process %s", pdf_path)
            failures.append((pdf_path, str(exc)))

    if failures:
        logging.error("Completed with %d failure(s):", len(failures))
        for pdf_path, err in failures:
            logging.error("  %s -> %s", pdf_path, err)
        return 2

    logging.info("Done. Processed %d PDF(s).", len(pdfs))
    return 0


if __name__ == "__main__":
    sys.exit(main())