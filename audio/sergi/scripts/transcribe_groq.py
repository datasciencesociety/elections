"""
Transcribe Bulgarian audio using Groq API (FREE).
Uses Whisper large-v3 on Groq's LPU hardware — fast and accurate.

Setup:
    1. Sign up at https://console.groq.com (free, no credit card)
    2. Create an API key
    3. export GROQ_API_KEY='gsk_...'

Usage:
    python scripts/transcribe_groq.py                          # all files in audio/data/
    python scripts/transcribe_groq.py audio/data/audio1.mp3    # single file

Dependencies:
    pip install groq
"""

import json
import os
import sys
from pathlib import Path

try:
    from groq import Groq
except ImportError:
    print("Install groq: pip install groq")
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"


def find_audio_files(path_arg: str | None = None) -> list[Path]:
    if path_arg:
        p = Path(path_arg)
        if p.exists():
            return [p]
        p = PROJECT_ROOT / path_arg
        if p.exists():
            return [p]
        raise FileNotFoundError(f"File not found: {path_arg}")

    files = sorted(DATA_DIR.glob("*.mp3")) + sorted(DATA_DIR.glob("*.mp4"))
    if not files:
        raise FileNotFoundError(f"No audio files in {DATA_DIR}")
    return files


def transcribe_file(client: Groq, audio_path: Path) -> dict:
    """Transcribe using Groq's free Whisper large-v3."""
    print(f"\nTranscribing: {audio_path.name} ({audio_path.stat().st_size / 1024 / 1024:.1f} MB)")

    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            file=(audio_path.name, f.read()),
            model="whisper-large-v3",
            language="bg",
            response_format="verbose_json",
            temperature=0.0,
        )

    return response.model_dump()


def save_results(result: dict, audio_path: Path):
    OUTPUT_DIR.mkdir(exist_ok=True)
    stem = audio_path.stem

    # JSON
    json_path = OUTPUT_DIR / f"{stem}_groq_large_v3.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, default=str)
    print(f"  Saved: {json_path}")

    # TXT
    txt_path = OUTPUT_DIR / f"{stem}_groq_large_v3.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        segments = result.get("segments", [])
        if segments:
            for seg in segments:
                start, end = seg.get("start", 0), seg.get("end", 0)
                text = seg.get("text", "").strip()
                m1, s1 = divmod(start, 60)
                m2, s2 = divmod(end, 60)
                f.write(f"[{int(m1):02d}:{s1:05.2f} - {int(m2):02d}:{s2:05.2f}] {text}\n")
        else:
            f.write(result.get("text", ""))
    print(f"  Saved: {txt_path}")

    # SRT
    srt_path = OUTPUT_DIR / f"{stem}_groq_large_v3.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(result.get("segments", []), 1):
            s = seg.get("start", 0)
            e = seg.get("end", 0)
            h1, r1 = divmod(s, 3600); m1, s1 = divmod(r1, 60)
            h2, r2 = divmod(e, 3600); m2, s2 = divmod(r2, 60)
            f.write(f"{i}\n")
            f.write(f"{int(h1):02d}:{int(m1):02d}:{int(s1):02d},{int((s1%1)*1000):03d} --> ")
            f.write(f"{int(h2):02d}:{int(m2):02d}:{int(s2):02d},{int((s2%1)*1000):03d}\n")
            f.write(f"{seg.get('text', '').strip()}\n\n")
    print(f"  Saved: {srt_path}")

    return txt_path


def main():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("ERROR: GROQ_API_KEY not set.")
        print("  1. Sign up free at https://console.groq.com")
        print("  2. Create API key")
        print("  3. export GROQ_API_KEY='gsk_...'")
        sys.exit(1)

    client = Groq(api_key=api_key)
    files = find_audio_files(sys.argv[1] if len(sys.argv) > 1 else None)

    print(f"Files to transcribe: {len(files)}")
    for f in files:
        print(f"  - {f.name} ({f.stat().st_size / 1024 / 1024:.1f} MB)")

    for audio_path in files:
        result = transcribe_file(client, audio_path)
        save_results(result, audio_path)

        # Preview
        text = result.get("text", "")
        print(f"\n  --- Preview ---")
        print(f"  {text[:300]}")
        print(f"  Total: {len(text)} chars")

    print(f"\nDone! Results in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
