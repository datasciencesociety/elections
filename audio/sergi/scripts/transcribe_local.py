"""
Local transcription using openai-whisper (already installed).
Processes mp3/mp4 files directly — no conversion needed.

Completely free, no API keys required.

Usage:
    python scripts/transcribe_local.py                          # all files in audio/data/
    python scripts/transcribe_local.py audio/data/audio1.mp3    # single file
    python scripts/transcribe_local.py --model medium            # specify model

Models (ranked by Bulgarian quality, CPU trade-off):
    turbo    — best quality/speed ratio on CPU (~809M params)
    medium   — good BG quality, reasonable on CPU (~769M params)
    small    — faster, decent BG quality (~244M params)
    large-v3 — best BG quality but very slow on CPU (~1.5B params)
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Fix: conda ffmpeg has broken libopenh264 — prefer system ffmpeg
try:
    subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
except (subprocess.CalledProcessError, OSError):
    os.environ["PATH"] = "/usr/bin:" + os.environ.get("PATH", "")

import whisper

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"


def find_audio_files(path_arg: str | None = None) -> list[Path]:
    """Find audio/video files to transcribe."""
    if path_arg:
        p = Path(path_arg)
        if p.exists():
            return [p]
        # Try relative to project root
        p = PROJECT_ROOT / path_arg
        if p.exists():
            return [p]
        raise FileNotFoundError(f"File not found: {path_arg}")

    # Default: all mp3/mp4 files in audio/data/
    files = sorted(DATA_DIR.glob("*.mp3")) + sorted(DATA_DIR.glob("*.mp4"))
    if not files:
        raise FileNotFoundError(f"No audio/video files found in {DATA_DIR}")
    return files


def transcribe_file(model, audio_path: Path) -> dict:
    """Transcribe a single file."""
    print(f"\nTranscribing: {audio_path.name} ({audio_path.stat().st_size / 1024 / 1024:.1f} MB)")
    print("Language: Bulgarian (bg)")

    result = model.transcribe(
        str(audio_path),
        language="bg",
        task="transcribe",
        verbose=False,
        word_timestamps=False,
        condition_on_previous_text=False,  # prevents hallucination cascades
        no_speech_threshold=0.6,           # stricter silence detection
        compression_ratio_threshold=2.4,   # reject garbled segments
    )

    print(f"  -> {len(result['segments'])} segments, detected language: {result.get('language', 'bg')}")
    return result


def save_results(result: dict, audio_path: Path, model_name: str):
    """Save transcription in multiple formats."""
    OUTPUT_DIR.mkdir(exist_ok=True)
    stem = audio_path.stem

    # Save full JSON (segments with word timestamps)
    json_path = OUTPUT_DIR / f"{stem}_{model_name}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, default=str)
    print(f"  Saved: {json_path}")

    # Save readable transcript with timestamps
    txt_path = OUTPUT_DIR / f"{stem}_{model_name}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for seg in result["segments"]:
            start = seg["start"]
            end = seg["end"]
            text = seg["text"].strip()
            f.write(f"[{_fmt(start)} - {_fmt(end)}] {text}\n")
    print(f"  Saved: {txt_path}")

    # Save SRT subtitle file
    srt_path = OUTPUT_DIR / f"{stem}_{model_name}.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(result["segments"], 1):
            f.write(f"{i}\n")
            f.write(f"{_fmt_srt(seg['start'])} --> {_fmt_srt(seg['end'])}\n")
            f.write(f"{seg['text'].strip()}\n\n")
    print(f"  Saved: {srt_path}")

    return txt_path


def _fmt(seconds: float) -> str:
    m, s = divmod(seconds, 60)
    return f"{int(m):02d}:{s:05.2f}"


def _fmt_srt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    parser = argparse.ArgumentParser(description="Transcribe Bulgarian audio with Whisper")
    parser.add_argument("file", nargs="?", help="Audio/video file path (default: all in audio/data/)")
    parser.add_argument("--model", default="turbo", help="Whisper model: tiny/base/small/medium/turbo/large-v3 (default: turbo)")
    args = parser.parse_args()

    files = find_audio_files(args.file)
    print(f"Files to transcribe: {len(files)}")
    for f in files:
        print(f"  - {f.name} ({f.stat().st_size / 1024 / 1024:.1f} MB)")

    print(f"\nLoading Whisper model: {args.model}")
    model = whisper.load_model(args.model)
    print(f"Model loaded on: {model.device}")

    for audio_path in files:
        result = transcribe_file(model, audio_path)
        txt_path = save_results(result, audio_path, args.model)

        # Print preview
        print(f"\n  --- Preview ({audio_path.name}) ---")
        for seg in result["segments"][:5]:
            print(f"  [{_fmt(seg['start'])}] {seg['text'].strip()}")
        if len(result["segments"]) > 5:
            print(f"  ... ({len(result['segments']) - 5} more segments)")

    print(f"\nDone! Results in: {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
