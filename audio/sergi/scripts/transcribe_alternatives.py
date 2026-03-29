"""
Transcribe Bulgarian audio using alternative models:
1. facebook/mms-1b-all (Meta's MMS, 1B params, Bulgarian adapter)
2. infinitejoy/wav2vec2-large-xls-r-300m-bulgarian (300M, fine-tuned BG)

Both are CTC-based — no punctuation/casing, no timestamps.

Usage:
    python scripts/transcribe_alternatives.py data/shorter.wav --model mms
    python scripts/transcribe_alternatives.py data/shorter.wav --model wav2vec2
    python scripts/transcribe_alternatives.py data/shorter.wav --model all
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Fix ffmpeg
try:
    subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
except (subprocess.CalledProcessError, OSError):
    os.environ["PATH"] = "/usr/bin:" + os.environ.get("PATH", "")

import torch
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"


def load_audio(audio_path: Path, target_sr: int = 16000) -> np.ndarray:
    """Load audio as numpy array at target sample rate using ffmpeg."""
    cmd = [
        "ffmpeg", "-nostdin", "-i", str(audio_path),
        "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le",
        "-ar", str(target_sr), "-"
    ]
    result = subprocess.run(cmd, capture_output=True, check=True)
    audio = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return audio


def transcribe_mms(audio_path: Path) -> dict:
    """Transcribe using facebook/mms-1b-all with Bulgarian adapter."""
    from transformers import Wav2Vec2ForCTC, AutoProcessor

    model_id = "facebook/mms-1b-all"
    print(f"  Loading model: {model_id}")

    processor = AutoProcessor.from_pretrained(model_id)
    model = Wav2Vec2ForCTC.from_pretrained(model_id)

    # Set Bulgarian language
    processor.tokenizer.set_target_lang("bul")
    model.load_adapter("bul")
    model.eval()

    print(f"  Loading audio: {audio_path.name}")
    audio = load_audio(audio_path)
    duration = len(audio) / 16000

    print(f"  Audio: {duration:.1f}s ({duration/60:.1f} min)")
    print("  Transcribing...")

    # Process in chunks to avoid OOM (30s chunks)
    chunk_size = 30 * 16000
    all_text = []

    for i in range(0, len(audio), chunk_size):
        chunk = audio[i:i + chunk_size]
        inputs = processor(chunk, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits
        ids = torch.argmax(logits, dim=-1)[0]
        text = processor.decode(ids)
        if text.strip():
            chunk_start = i / 16000
            chunk_end = min((i + chunk_size) / 16000, duration)
            all_text.append({
                "start": round(chunk_start, 2),
                "end": round(chunk_end, 2),
                "text": text.strip(),
            })

    full_text = " ".join(seg["text"] for seg in all_text)
    return {"text": full_text, "segments": all_text}


def transcribe_wav2vec2(audio_path: Path) -> dict:
    """Transcribe using infinitejoy/wav2vec2-large-xls-r-300m-bulgarian."""
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    model_id = "infinitejoy/wav2vec2-large-xls-r-300m-bulgarian"
    print(f"  Loading model: {model_id}")

    processor = Wav2Vec2Processor.from_pretrained(model_id)
    model = Wav2Vec2ForCTC.from_pretrained(model_id)
    model.eval()

    print(f"  Loading audio: {audio_path.name}")
    audio = load_audio(audio_path)
    duration = len(audio) / 16000

    print(f"  Audio: {duration:.1f}s ({duration/60:.1f} min)")
    print("  Transcribing...")

    # Process in chunks
    chunk_size = 30 * 16000
    all_text = []

    for i in range(0, len(audio), chunk_size):
        chunk = audio[i:i + chunk_size]
        inputs = processor(chunk, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = model(**inputs).logits
        predicted_ids = torch.argmax(logits, dim=-1)
        text = processor.batch_decode(predicted_ids)[0]
        if text.strip():
            chunk_start = i / 16000
            chunk_end = min((i + chunk_size) / 16000, duration)
            all_text.append({
                "start": round(chunk_start, 2),
                "end": round(chunk_end, 2),
                "text": text.strip(),
            })

    full_text = " ".join(seg["text"] for seg in all_text)
    return {"text": full_text, "segments": all_text}


def save_results(result: dict, audio_path: Path, model_tag: str):
    OUTPUT_DIR.mkdir(exist_ok=True)
    stem = audio_path.stem

    # JSON
    json_path = OUTPUT_DIR / f"{stem}_{model_tag}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  Saved: {json_path}")

    # TXT
    txt_path = OUTPUT_DIR / f"{stem}_{model_tag}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for seg in result.get("segments", []):
            s, e = seg["start"], seg["end"]
            m1, s1 = divmod(s, 60)
            m2, s2 = divmod(e, 60)
            f.write(f"[{int(m1):02d}:{s1:05.2f} - {int(m2):02d}:{s2:05.2f}] {seg['text']}\n")
    print(f"  Saved: {txt_path}")

    # SRT
    srt_path = OUTPUT_DIR / f"{stem}_{model_tag}.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(result.get("segments", []), 1):
            h1, r1 = divmod(seg["start"], 3600); m1, s1 = divmod(r1, 60)
            h2, r2 = divmod(seg["end"], 3600); m2, s2 = divmod(r2, 60)
            f.write(f"{i}\n")
            f.write(f"{int(h1):02d}:{int(m1):02d}:{int(s1):02d},{int((s1%1)*1000):03d} --> ")
            f.write(f"{int(h2):02d}:{int(m2):02d}:{int(s2):02d},{int((s2%1)*1000):03d}\n")
            f.write(f"{seg['text']}\n\n")
    print(f"  Saved: {srt_path}")


MODELS = {
    "mms": ("facebook/mms-1b-all", transcribe_mms, "mms_1b"),
    "wav2vec2": ("infinitejoy/wav2vec2-large-xls-r-300m-bulgarian", transcribe_wav2vec2, "wav2vec2_bg"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="Audio file (WAV preferred, 16kHz mono)")
    parser.add_argument("--model", default="all", choices=["mms", "wav2vec2", "all"])
    args = parser.parse_args()

    audio_path = Path(args.file)
    if not audio_path.exists():
        audio_path = PROJECT_ROOT / args.file
    if not audio_path.exists():
        print(f"File not found: {args.file}")
        sys.exit(1)

    models_to_run = list(MODELS.keys()) if args.model == "all" else [args.model]

    for model_key in models_to_run:
        name, fn, tag = MODELS[model_key]
        print(f"\n{'='*60}")
        print(f"Model: {name}")
        print(f"{'='*60}")

        t0 = time.time()
        try:
            result = fn(audio_path)
            elapsed = time.time() - t0
            print(f"  Time: {elapsed:.0f}s")
            save_results(result, audio_path, tag)

            # Preview
            print(f"\n  --- Preview ---")
            for seg in result["segments"][:5]:
                print(f"  [{seg['start']:.0f}s-{seg['end']:.0f}s] {seg['text'][:80]}")
            if len(result["segments"]) > 5:
                print(f"  ... ({len(result['segments']) - 5} more)")
        except Exception as e:
            elapsed = time.time() - t0
            print(f"  FAILED after {elapsed:.0f}s: {e}")

    print("\nDone!")


if __name__ == "__main__":
    main()
