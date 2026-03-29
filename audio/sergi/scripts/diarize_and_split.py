"""
Speaker diarization + audio splitting + per-speaker transcription.

Uses pyannote.audio for speaker diarization and Whisper for transcription.
Splits audio into per-speaker files and produces speaker-labeled transcripts.

Prerequisites:
    1. pip install pyannote.audio  (already in requirements.txt)
    2. Accept pyannote model licenses at:
       https://huggingface.co/pyannote/speaker-diarization-3.1
       https://huggingface.co/pyannote/segmentation-3.0
    3. export HF_TOKEN='hf_...'

Usage:
    python scripts/diarize_and_split.py audio/data/audio1.mp3
    python scripts/diarize_and_split.py audio/data/audio1.mp3 --model turbo
    python scripts/diarize_and_split.py audio/data/audio1.mp3 --num-speakers 2
"""

import argparse
import gc
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

import torch
import whisper

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "audio" / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"


def convert_to_wav(audio_path: Path) -> Path:
    """Convert audio to WAV 16kHz mono if needed. Returns path to WAV file."""
    if audio_path.suffix.lower() == ".wav":
        return audio_path

    wav_path = audio_path.with_suffix(".wav")
    if wav_path.exists():
        print(f"  WAV already exists: {wav_path.name}")
        return wav_path

    print(f"  Converting to WAV: {audio_path.name} -> {wav_path.name}")
    subprocess.run(
        [
            "ffmpeg", "-i", str(audio_path),
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            "-y", str(wav_path),
        ],
        capture_output=True,
        check=True,
    )
    return wav_path


def run_diarization(wav_path: Path, hf_token: str, num_speakers: int | None = None) -> list[dict]:
    """Run pyannote speaker diarization. Returns list of {speaker, start, end}."""
    from pyannote.audio import Pipeline

    print("\nLoading pyannote speaker diarization pipeline...")
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    pipeline.to(device)
    print(f"  Pipeline loaded on: {device}")

    print(f"  Running diarization on: {wav_path.name}")
    diarization_kwargs = {}
    if num_speakers is not None:
        diarization_kwargs["num_speakers"] = num_speakers

    diarization = pipeline(str(wav_path), **diarization_kwargs)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "speaker": speaker,
            "start": round(turn.start, 3),
            "end": round(turn.end, 3),
        })

    speakers = sorted(set(s["speaker"] for s in segments))
    print(f"  Found {len(speakers)} speakers: {', '.join(speakers)}")
    print(f"  Total diarization segments: {len(segments)}")

    # Release pyannote to free memory before loading Whisper
    del pipeline
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return segments


def run_transcription(audio_path: Path, model_name: str) -> dict:
    """Transcribe full audio with Whisper. Returns Whisper result dict."""
    print(f"\nLoading Whisper model: {model_name}")
    model = whisper.load_model(model_name)
    print(f"  Model loaded on: {model.device}")

    print(f"  Transcribing: {audio_path.name}")
    result = model.transcribe(
        str(audio_path),
        language="bg",
        task="transcribe",
        verbose=False,
        word_timestamps=True,
    )
    print(f"  -> {len(result['segments'])} segments transcribed")

    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return result


def merge_diarization_with_transcript(
    diar_segments: list[dict], whisper_segments: list[dict]
) -> list[dict]:
    """Assign speaker labels to Whisper segments by timestamp overlap."""
    merged = []
    for wseg in whisper_segments:
        w_mid = (wseg["start"] + wseg["end"]) / 2
        best_speaker = None
        best_dist = float("inf")

        for dseg in diar_segments:
            if dseg["start"] <= w_mid <= dseg["end"]:
                best_speaker = dseg["speaker"]
                best_dist = 0
                break
            # Track nearest segment in case midpoint falls in a gap
            dist = min(abs(w_mid - dseg["start"]), abs(w_mid - dseg["end"]))
            if dist < best_dist:
                best_dist = dist
                best_speaker = dseg["speaker"]

        merged.append({
            "speaker": best_speaker or "UNKNOWN",
            "start": wseg["start"],
            "end": wseg["end"],
            "text": wseg["text"].strip(),
        })
    return merged


def split_audio_by_speaker(
    wav_path: Path, diar_segments: list[dict], output_dir: Path
) -> dict[str, Path]:
    """Extract per-speaker audio files using ffmpeg atrim+concat filter."""
    speakers = sorted(set(s["speaker"] for s in diar_segments))
    speaker_files = {}
    stem = wav_path.stem

    for speaker in speakers:
        segs = [s for s in diar_segments if s["speaker"] == speaker]
        if not segs:
            continue

        speaker_suffix = speaker.replace("SPEAKER_", "speaker_")
        out_path = output_dir / f"{stem}_{speaker_suffix}.wav"

        # Build ffmpeg filter_complex: extract each segment with atrim, then concat
        filter_parts = []
        concat_inputs = []
        for i, seg in enumerate(segs):
            label = f"s{i}"
            filter_parts.append(
                f"[0]atrim=start={seg['start']}:end={seg['end']},asetpts=PTS-STARTPTS[{label}]"
            )
            concat_inputs.append(f"[{label}]")

        filter_complex = "; ".join(filter_parts)
        filter_complex += f"; {''.join(concat_inputs)}concat=n={len(segs)}:v=0:a=1[out]"

        cmd = [
            "ffmpeg", "-i", str(wav_path),
            "-filter_complex", filter_complex,
            "-map", "[out]",
            "-ar", "16000", "-ac", "1",
            "-y", str(out_path),
        ]
        subprocess.run(cmd, capture_output=True, check=True)

        duration = sum(s["end"] - s["start"] for s in segs)
        print(f"  Saved: {out_path.name} ({len(segs)} segments, {duration:.1f}s)")
        speaker_files[speaker] = out_path

    return speaker_files


def save_diarized_results(
    merged_segments: list[dict], audio_path: Path, output_dir: Path, model_name: str
):
    """Save combined diarized transcript in JSON, TXT, and SRT formats."""
    stem = audio_path.stem
    speakers = sorted(set(s["speaker"] for s in merged_segments))

    # JSON
    json_path = output_dir / f"{stem}_diarized.json"
    data = {
        "audio_file": audio_path.name,
        "model": model_name,
        "num_speakers": len(speakers),
        "speakers": speakers,
        "segments": merged_segments,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  Saved: {json_path.name}")

    # TXT
    txt_path = output_dir / f"{stem}_diarized.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for seg in merged_segments:
            f.write(f"[{_fmt(seg['start'])} - {_fmt(seg['end'])}] {seg['speaker']}: {seg['text']}\n")
    print(f"  Saved: {txt_path.name}")

    # SRT
    srt_path = output_dir / f"{stem}_diarized.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(merged_segments, 1):
            f.write(f"{i}\n")
            f.write(f"{_fmt_srt(seg['start'])} --> {_fmt_srt(seg['end'])}\n")
            f.write(f"{seg['speaker']}: {seg['text']}\n\n")
    print(f"  Saved: {srt_path.name}")


def save_speaker_transcripts(
    merged_segments: list[dict], output_dir: Path, audio_stem: str
):
    """Save per-speaker transcript TXT files."""
    speakers = sorted(set(s["speaker"] for s in merged_segments))
    for speaker in speakers:
        segs = [s for s in merged_segments if s["speaker"] == speaker]
        speaker_suffix = speaker.replace("SPEAKER_", "speaker_")
        txt_path = output_dir / f"{audio_stem}_{speaker_suffix}.txt"
        with open(txt_path, "w", encoding="utf-8") as f:
            for seg in segs:
                f.write(f"[{_fmt(seg['start'])} - {_fmt(seg['end'])}] {seg['text']}\n")
        print(f"  Saved: {txt_path.name}")


def _fmt(seconds: float) -> str:
    m, s = divmod(seconds, 60)
    return f"{int(m):02d}:{s:05.2f}"


def _fmt_srt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def get_hf_token(cli_token: str | None) -> str:
    """Get HuggingFace token from CLI arg or environment."""
    token = cli_token or os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HuggingFace token required for pyannote speaker diarization.")
        print()
        print("Setup steps:")
        print("  1. Create account at https://huggingface.co")
        print("  2. Accept model licenses:")
        print("     https://huggingface.co/pyannote/speaker-diarization-3.1")
        print("     https://huggingface.co/pyannote/segmentation-3.0")
        print("  3. Get token at https://huggingface.co/settings/tokens")
        print("  4. export HF_TOKEN='hf_...'")
        print("     or pass --hf-token 'hf_...'")
        sys.exit(1)
    return token


def main():
    parser = argparse.ArgumentParser(
        description="Speaker diarization + audio splitting + per-speaker transcription (Bulgarian)"
    )
    parser.add_argument("file", help="Audio/video file path")
    parser.add_argument(
        "--model", default="turbo",
        help="Whisper model: tiny/base/small/medium/turbo/large-v3 (default: turbo)",
    )
    parser.add_argument(
        "--num-speakers", type=int, default=None,
        help="Number of speakers (optional, auto-detected if not set)",
    )
    parser.add_argument(
        "--hf-token", default=None,
        help="HuggingFace token (or set HF_TOKEN env var)",
    )
    parser.add_argument(
        "--skip-split", action="store_true",
        help="Skip audio splitting, only produce diarized transcript",
    )
    args = parser.parse_args()

    # Validate input file
    audio_path = Path(args.file)
    if not audio_path.exists():
        audio_path = PROJECT_ROOT / args.file
    if not audio_path.exists():
        print(f"ERROR: File not found: {args.file}")
        sys.exit(1)

    print(f"Input: {audio_path.name} ({audio_path.stat().st_size / 1024 / 1024:.1f} MB)")

    # Validate HF token
    hf_token = get_hf_token(args.hf_token)

    # Create output directory
    output_dir = OUTPUT_DIR / f"{audio_path.stem}_speakers"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 0: Convert to WAV
    wav_path = convert_to_wav(audio_path)

    # Step 1: Speaker diarization (runs first, then releases memory)
    diar_segments = run_diarization(wav_path, hf_token, args.num_speakers)

    if not diar_segments:
        print("WARNING: No speaker segments detected. Falling back to single-speaker transcript.")
        diar_segments = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 999999.0}]

    # Step 2: Whisper transcription
    whisper_result = run_transcription(audio_path, args.model)

    # Step 3: Merge diarization with transcript
    print("\nMerging diarization with transcript...")
    merged = merge_diarization_with_transcript(diar_segments, whisper_result["segments"])

    # Step 4: Split audio by speaker
    if not args.skip_split:
        print("\nSplitting audio by speaker...")
        split_audio_by_speaker(wav_path, diar_segments, output_dir)

    # Step 5: Save outputs
    print("\nSaving diarized transcript...")
    save_diarized_results(merged, audio_path, output_dir, args.model)

    print("\nSaving per-speaker transcripts...")
    save_speaker_transcripts(merged, output_dir, audio_path.stem)

    # Print preview
    speakers = sorted(set(s["speaker"] for s in merged))
    print(f"\n{'='*60}")
    print(f"Done! {len(speakers)} speakers identified.")
    print(f"Results in: {output_dir}/")
    print(f"{'='*60}")

    for speaker in speakers:
        segs = [s for s in merged if s["speaker"] == speaker]
        print(f"\n  --- {speaker} ({len(segs)} segments) ---")
        for seg in segs[:3]:
            print(f"  [{_fmt(seg['start'])}] {seg['text']}")
        if len(segs) > 3:
            print(f"  ... ({len(segs) - 3} more segments)")


if __name__ == "__main__":
    main()
