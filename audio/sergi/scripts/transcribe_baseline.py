"""
Baseline transcription script using OpenAI gpt-4o-transcribe-diarize API.

This is the Phase 1 approach — quickest path to Bulgarian transcription
with speaker diarization.

Usage:
    python scripts/transcribe_baseline.py [audio_file.wav]

Dependencies:
    pip install openai

Environment:
    OPENAI_API_KEY must be set.
"""

import json
import os
import sys
from pathlib import Path

from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = PROJECT_ROOT / "audio"
OUTPUT_DIR = PROJECT_ROOT / "output"


def find_audio_file(path_arg: str | None = None) -> Path:
    """Find audio file to transcribe."""
    if path_arg:
        p = Path(path_arg)
        if p.exists():
            return p

    # Default: first .wav in audio/
    wav_files = sorted(AUDIO_DIR.glob("*.wav"))
    if wav_files:
        return wav_files[0]

    raise FileNotFoundError(
        "No audio file found. Run download_video.py first or pass a file path."
    )


def transcribe_with_diarization(audio_path: Path) -> dict:
    """Transcribe using OpenAI gpt-4o-transcribe-diarize (built-in diarization)."""
    client = OpenAI()

    print(f"Transcribing: {audio_path.name}")
    print("Model: gpt-4o-transcribe-diarize (Bulgarian, with speaker diarization)")

    # Check file size — API limit is 25MB per request
    file_size_mb = audio_path.stat().st_size / (1024 * 1024)
    print(f"File size: {file_size_mb:.1f} MB")

    if file_size_mb > 25:
        print("WARNING: File exceeds 25MB limit. Consider chunking.")
        print("Proceeding with first chunk...")

    with open(audio_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="gpt-4o-transcribe-diarize",
            file=audio_file,
            language="bg",
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    return response.model_dump()


def transcribe_with_whisper_api(audio_path: Path) -> dict:
    """Fallback: Transcribe using whisper-1 API (no diarization)."""
    client = OpenAI()

    print(f"Transcribing: {audio_path.name}")
    print("Model: whisper-1 (Bulgarian, no diarization)")

    with open(audio_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="bg",
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    return response.model_dump()


def save_results(result: dict, audio_path: Path, model_name: str):
    """Save transcription results."""
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Save raw JSON
    json_path = OUTPUT_DIR / f"{audio_path.stem}_{model_name}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Saved JSON: {json_path}")

    # Save readable transcript
    txt_path = OUTPUT_DIR / f"{audio_path.stem}_{model_name}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        if "segments" in result:
            for seg in result["segments"]:
                speaker = seg.get("speaker", "UNKNOWN")
                start = seg.get("start", 0)
                end = seg.get("end", 0)
                text = seg.get("text", "").strip()
                f.write(f"[{start:.1f}s - {end:.1f}s] {speaker}: {text}\n")
        else:
            f.write(result.get("text", ""))
    print(f"Saved transcript: {txt_path}")


def main():
    audio_path = find_audio_file(sys.argv[1] if len(sys.argv) > 1 else None)

    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY not set.")
        print("  export OPENAI_API_KEY='sk-...'")
        sys.exit(1)

    # Try diarization model first, fall back to whisper-1
    try:
        result = transcribe_with_diarization(audio_path)
        model_name = "gpt4o_diarize"
    except Exception as e:
        print(f"Diarization model failed ({e}), falling back to whisper-1...")
        result = transcribe_with_whisper_api(audio_path)
        model_name = "whisper1"

    save_results(result, audio_path, model_name)

    # Print summary
    text = result.get("text", "")
    print(f"\n--- Transcript Preview (first 500 chars) ---")
    print(text[:500])
    print(f"\nTotal length: {len(text)} characters")


if __name__ == "__main__":
    main()
