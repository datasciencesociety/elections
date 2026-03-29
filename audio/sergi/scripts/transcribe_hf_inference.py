"""
Transcribe Bulgarian audio using HuggingFace Inference API (free).
Runs NVIDIA models on HF's servers — no local GPU/RAM needed.

Models:
1. nvidia/parakeet-tdt-0.6b-v3 (600M, 12.64% WER on BG)
2. nvidia/canary-1b-v2 (978M, 9.25% WER on BG)

Usage:
    python scripts/transcribe_hf_inference.py output/model_comparison/filtered_6to12min.wav
    python scripts/transcribe_hf_inference.py output/model_comparison/filtered_6to12min.wav --model parakeet
    python scripts/transcribe_hf_inference.py output/model_comparison/filtered_6to12min.wav --model canary

Dependencies:
    pip install huggingface_hub requests
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"

HF_MODELS = {
    "parakeet": {
        "id": "nvidia/parakeet-tdt-0.6b-v3",
        "tag": "parakeet_tdt",
    },
    "canary": {
        "id": "nvidia/canary-1b-v2",
        "tag": "canary_1b",
    },
}

API_URL = "https://api-inference.huggingface.co/models/{model_id}"


def transcribe_hf(audio_path: Path, model_id: str, hf_token: str | None = None) -> dict:
    """Transcribe using HuggingFace Inference API via huggingface_hub client."""
    from huggingface_hub import InferenceClient

    print(f"  Sending {audio_path.stat().st_size/1024/1024:.1f} MB to {model_id}...")

    client = InferenceClient(token=hf_token) if hf_token else InferenceClient()

    # Retry on model loading
    for attempt in range(3):
        try:
            result = client.automatic_speech_recognition(
                str(audio_path),
                model=model_id,
            )
            break
        except Exception as e:
            if "loading" in str(e).lower() or "503" in str(e):
                print(f"  Model loading, waiting 30s (attempt {attempt+1}/3)...")
                time.sleep(30)
            else:
                raise
    else:
        raise RuntimeError(f"Model failed to load after 3 attempts")

    # result is an AutomaticSpeechRecognitionOutput or dict
    if hasattr(result, 'text'):
        text = result.text
        chunks = getattr(result, 'chunks', None) or []
    elif isinstance(result, dict):
        text = result.get("text", "")
        chunks = result.get("chunks", [])
    else:
        text = str(result)
        chunks = []

    result = {"text": text, "chunks": chunks}

    # Normalize response format
    if isinstance(result, dict):
        text = result.get("text", "")
        chunks = result.get("chunks", [])
    elif isinstance(result, list) and result:
        text = result[0].get("text", "") if isinstance(result[0], dict) else str(result[0])
        chunks = []
    else:
        text = str(result)
        chunks = []

    segments = []
    if chunks:
        for ch in chunks:
            ts = ch.get("timestamp", [0, 0])
            segments.append({
                "start": ts[0] if ts[0] is not None else 0,
                "end": ts[1] if ts[1] is not None else 0,
                "text": ch.get("text", "").strip(),
            })
    else:
        segments.append({"start": 0, "end": 0, "text": text})

    return {"text": text, "segments": segments}


def save_results(result: dict, audio_path: Path, model_tag: str, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = audio_path.stem

    json_path = output_dir / f"{stem}_{model_tag}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  Saved: {json_path}")

    txt_path = output_dir / f"{stem}_{model_tag}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for seg in result.get("segments", []):
            s, e = seg["start"], seg["end"]
            m1, s1 = divmod(s, 60)
            m2, s2 = divmod(e, 60)
            f.write(f"[{int(m1):02d}:{s1:05.2f} - {int(m2):02d}:{s2:05.2f}] {seg['text']}\n")
    print(f"  Saved: {txt_path}")

    srt_path = output_dir / f"{stem}_{model_tag}.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(result.get("segments", []), 1):
            h1, r1 = divmod(seg["start"], 3600); m1, s1 = divmod(r1, 60)
            h2, r2 = divmod(seg["end"], 3600); m2, s2 = divmod(r2, 60)
            f.write(f"{i}\n")
            f.write(f"{int(h1):02d}:{int(m1):02d}:{int(s1):02d},{int((s1%1)*1000):03d} --> ")
            f.write(f"{int(h2):02d}:{int(m2):02d}:{int(s2):02d},{int((s2%1)*1000):03d}\n")
            f.write(f"{seg['text']}\n\n")
    print(f"  Saved: {srt_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="Audio file (WAV)")
    parser.add_argument("--model", default="all", choices=["parakeet", "canary", "all"])
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    audio_path = Path(args.file)
    if not audio_path.exists():
        audio_path = PROJECT_ROOT / args.file
    if not audio_path.exists():
        print(f"File not found: {args.file}")
        sys.exit(1)

    out_dir = Path(args.output_dir) if args.output_dir else OUTPUT_DIR
    hf_token = os.getenv("HF_TOKEN")

    models_to_run = list(HF_MODELS.keys()) if args.model == "all" else [args.model]

    for model_key in models_to_run:
        info = HF_MODELS[model_key]
        print(f"\n{'='*60}")
        print(f"Model: {info['id']}")
        print(f"{'='*60}")

        t0 = time.time()
        try:
            result = transcribe_hf(audio_path, info["id"], hf_token)
            elapsed = time.time() - t0
            print(f"  Time: {elapsed:.0f}s")
            save_results(result, audio_path, info["tag"], out_dir)

            print(f"\n  --- Preview ---")
            for seg in result["segments"][:5]:
                print(f"  [{seg['start']:.1f}s-{seg['end']:.1f}s] {seg['text'][:80]}")
            if len(result["segments"]) > 5:
                print(f"  ... ({len(result['segments']) - 5} more)")
        except Exception as e:
            elapsed = time.time() - t0
            print(f"  FAILED after {elapsed:.0f}s: {e}")

    print("\nDone!")


if __name__ == "__main__":
    main()
