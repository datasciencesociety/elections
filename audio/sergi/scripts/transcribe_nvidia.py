"""
Transcribe Bulgarian audio using NVIDIA NeMo models:
1. nvidia/parakeet-tdt-0.6b-v3 (600M params, 12.64% WER on BG)
2. nvidia/canary-1b-v2 (978M params, 9.25% WER on BG)

Usage:
    python scripts/transcribe_nvidia.py data/shorter.wav --model parakeet
    python scripts/transcribe_nvidia.py data/shorter.wav --model canary
    python scripts/transcribe_nvidia.py data/shorter.wav --model all

Dependencies:
    pip install nemo_toolkit[asr]
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

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"


def transcribe_parakeet(audio_path: Path) -> dict:
    """Transcribe using nvidia/parakeet-tdt-0.6b-v3 (600M params)."""
    import nemo.collections.asr as nemo_asr

    model_id = "nvidia/parakeet-tdt-0.6b-v3"
    print(f"  Loading: {model_id}")
    asr_model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(model_id)

    # For long audio, use local attention
    asr_model.change_attention_model("rel_pos_local_attn", att_context_size=[256, 256])

    print(f"  Transcribing: {audio_path.name}")
    output = asr_model.transcribe([str(audio_path)], timestamps=True)

    # Extract segments from timestamps
    segments = []
    if hasattr(output[0], 'timestamp') and output[0].timestamp:
        for stamp in output[0].timestamp.get("segment", []):
            segments.append({
                "start": round(stamp["start"], 2),
                "end": round(stamp["end"], 2),
                "text": stamp["segment"].strip(),
            })
    else:
        segments.append({"start": 0, "end": 0, "text": output[0].text})

    return {"text": output[0].text, "segments": segments}


def transcribe_canary(audio_path: Path) -> dict:
    """Transcribe using nvidia/canary-1b-v2 (978M params)."""
    import nemo.collections.asr as nemo_asr

    model_id = "nvidia/canary-1b-v2"
    print(f"  Loading: {model_id}")
    model = nemo_asr.models.EncDecMultiTaskModel.from_pretrained(model_id)

    print(f"  Transcribing: {audio_path.name}")
    output = model.transcribe(
        [str(audio_path)],
        source_lang="bg",
        target_lang="bg",
        timestamps=True,
    )

    segments = []
    if hasattr(output[0], 'timestamp') and output[0].timestamp:
        for stamp in output[0].timestamp.get("segment", []):
            segments.append({
                "start": round(stamp["start"], 2),
                "end": round(stamp["end"], 2),
                "text": stamp["segment"].strip(),
            })
    else:
        segments.append({"start": 0, "end": 0, "text": output[0].text})

    return {"text": output[0].text, "segments": segments}


def save_results(result: dict, audio_path: Path, model_tag: str, output_dir: Path = None):
    out_dir = output_dir or OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = audio_path.stem

    # JSON
    json_path = out_dir / f"{stem}_{model_tag}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  Saved: {json_path}")

    # TXT
    txt_path = out_dir / f"{stem}_{model_tag}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for seg in result.get("segments", []):
            s, e = seg["start"], seg["end"]
            m1, s1 = divmod(s, 60)
            m2, s2 = divmod(e, 60)
            f.write(f"[{int(m1):02d}:{s1:05.2f} - {int(m2):02d}:{s2:05.2f}] {seg['text']}\n")
    print(f"  Saved: {txt_path}")

    # SRT
    srt_path = out_dir / f"{stem}_{model_tag}.srt"
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
    "parakeet": ("nvidia/parakeet-tdt-0.6b-v3", transcribe_parakeet, "parakeet_tdt"),
    "canary": ("nvidia/canary-1b-v2", transcribe_canary, "canary_1b"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="Audio file (WAV, 16kHz mono)")
    parser.add_argument("--model", default="all", choices=["parakeet", "canary", "all"])
    parser.add_argument("--output-dir", default=None, help="Custom output directory")
    args = parser.parse_args()

    audio_path = Path(args.file)
    if not audio_path.exists():
        audio_path = PROJECT_ROOT / args.file
    if not audio_path.exists():
        print(f"File not found: {args.file}")
        sys.exit(1)

    out_dir = Path(args.output_dir) if args.output_dir else OUTPUT_DIR

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
            save_results(result, audio_path, tag, out_dir)

            # Preview
            print(f"\n  --- Preview ---")
            for seg in result["segments"][:5]:
                print(f"  [{seg['start']:.1f}s-{seg['end']:.1f}s] {seg['text'][:80]}")
            if len(result["segments"]) > 5:
                print(f"  ... ({len(result['segments']) - 5} more)")

            # Free memory
            del result
            import gc; gc.collect()
            import torch; torch.cuda.empty_cache() if torch.cuda.is_available() else None
        except Exception as e:
            elapsed = time.time() - t0
            print(f"  FAILED after {elapsed:.0f}s: {e}")
            import traceback; traceback.print_exc()

    print("\nDone!")


if __name__ == "__main__":
    main()
