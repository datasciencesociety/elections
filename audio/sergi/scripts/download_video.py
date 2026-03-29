"""
Download YouTube video and extract audio for transcription.

Usage:
    python scripts/download_video.py [URL]

Dependencies:
    pip install yt-dlp
"""

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
AUDIO_DIR = PROJECT_ROOT / "audio"

DEFAULT_URL = "https://youtu.be/BrbGONQeEt8?si=1KaZD0a50X7-X7z_"


def download_video(url: str) -> Path:
    """Download video to data/ folder."""
    DATA_DIR.mkdir(exist_ok=True)
    output_template = str(DATA_DIR / "%(title)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--output", output_template,
        "--no-playlist",
        "--print", "filename",
        url,
    ]
    print(f"Downloading: {url}")
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    video_path = Path(result.stdout.strip().splitlines()[-1])
    print(f"Saved to: {video_path}")
    return video_path


def extract_audio(video_path: Path) -> Path:
    """Extract audio as 16kHz mono WAV (optimal for Whisper)."""
    AUDIO_DIR.mkdir(exist_ok=True)
    audio_path = AUDIO_DIR / f"{video_path.stem}.wav"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(audio_path),
    ]
    print(f"Extracting audio to: {audio_path}")
    subprocess.run(cmd, capture_output=True, text=True, check=True)
    print(f"Audio extracted: {audio_path}")
    return audio_path


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    video_path = download_video(url)
    audio_path = extract_audio(video_path)
    print(f"\nReady for transcription:")
    print(f"  Video: {video_path}")
    print(f"  Audio: {audio_path}")


if __name__ == "__main__":
    main()
