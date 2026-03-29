"""
Transcribe Bulgarian audio using a fine-tuned Whisper model for Bulgarian.

Model: sam8000/whisper-large-v3-turbo-bulgarian-bulgaria
  - Fine-tuned on FLEURS Bulgarian dataset
  - 9.97% WER — best available for Bulgarian
  - Turbo variant (809M params) — faster than large-v3

Usage:
    python scripts/transcribe_bg_finetuned.py                          # all mp3 in data/
    python scripts/transcribe_bg_finetuned.py data/audio1.mp3          # single file

Dependencies:
    pip install transformers torch torchaudio accelerate
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Fix conda ffmpeg
try:
    subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
except (subprocess.CalledProcessError, OSError):
    os.environ["PATH"] = "/usr/bin:" + os.environ.get("PATH", "")

import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"

MODEL_ID = "sam8000/whisper-large-v3-turbo-bulgarian-bulgaria"


def find_audio_files(path_arg: str | None = None) -> list[Path]:
    if path_arg:
        p = Path(path_arg)
        if p.exists():
            return [p]
        p = PROJECT_ROOT / path_arg
        if p.exists():
            return [p]
        raise FileNotFoundError(f"File not found: {path_arg}")

    files = sorted(DATA_DIR.glob("*.mp3"))
    if not files:
        raise FileNotFoundError(f"No mp3 files in {DATA_DIR}")
    return files


def save_results(result: dict, audio_path: Path, model_tag: str):
    OUTPUT_DIR.mkdir(exist_ok=True)
    stem = audio_path.stem

    # Build segments from chunks if available
    segments = []
    if "chunks" in result:
        for chunk in result["chunks"]:
            ts = chunk.get("timestamp", (0, 0))
            segments.append({
                "start": ts[0] if ts[0] is not None else 0,
                "end": ts[1] if ts[1] is not None else 0,
                "text": chunk.get("text", "").strip(),
            })
    else:
        segments.append({"start": 0, "end": 0, "text": result.get("text", "")})

    # JSON
    json_path = OUTPUT_DIR / f"{stem}_{model_tag}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"text": result.get("text", ""), "segments": segments},
                  f, ensure_ascii=False, indent=2)
    print(f"  Saved: {json_path}")

    # TXT
    txt_path = OUTPUT_DIR / f"{stem}_{model_tag}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for seg in segments:
            s, e = seg["start"], seg["end"]
            m1, s1 = divmod(s, 60)
            m2, s2 = divmod(e, 60)
            f.write(f"[{int(m1):02d}:{s1:05.2f} - {int(m2):02d}:{s2:05.2f}] {seg['text']}\n")
    print(f"  Saved: {txt_path}")

    # SRT
    srt_path = OUTPUT_DIR / f"{stem}_{model_tag}.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(segments, 1):
            h1, r1 = divmod(seg["start"], 3600); m1, s1 = divmod(r1, 60)
            h2, r2 = divmod(seg["end"], 3600); m2, s2 = divmod(r2, 60)
            f.write(f"{i}\n")
            f.write(f"{int(h1):02d}:{int(m1):02d}:{int(s1):02d},{int((s1%1)*1000):03d} --> ")
            f.write(f"{int(h2):02d}:{int(m2):02d}:{int(s2):02d},{int((s2%1)*1000):03d}\n")
            f.write(f"{seg['text']}\n\n")
    print(f"  Saved: {srt_path}")

    return segments


def main():
    files = find_audio_files(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"Files: {[f.name for f in files]}")

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

    print(f"\nLoading model: {MODEL_ID}")
    print(f"Device: {device}, dtype: {torch_dtype}")

    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
    )
    model.to(device)

    pipe = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        torch_dtype=torch_dtype,
        device=device,
    )
    print("Model loaded!")

    for audio_path in files:
        print(f"\nTranscribing: {audio_path.name} ({audio_path.stat().st_size / 1024 / 1024:.1f} MB)")
        t0 = time.time()

        result = pipe(
            str(audio_path),
            generate_kwargs={
                "language": "bulgarian",
                "task": "transcribe",
            },
            return_timestamps=True,
            chunk_length_s=30,
            batch_size=1,
        )

        elapsed = time.time() - t0
        print(f"  Time: {elapsed:.0f}s")

        segments = save_results(result, audio_path, "bg_finetuned")

        # Preview
        print(f"\n  --- Preview ---")
        for seg in segments[:8]:
            print(f"  [{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}")
        if len(segments) > 8:
            print(f"  ... ({len(segments) - 8} more)")

    print(f"\nDone! Results in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
