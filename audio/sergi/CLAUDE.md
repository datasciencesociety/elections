# Video Streaming Analysis Project

## Overview

This project analyzes video streaming content. The primary workflow involves extracting and processing audio transcripts from video sources.

## Project Structure

```
video_streaming/
  data/            # Source video files (mp4)
  audio/           # Extracted audio (WAV, 16kHz mono) for transcription
  output/          # Transcription results (JSON, TXT, SRT)
  scripts/         # Processing scripts (download, transcribe)
  docs/            # Documentation and model comparisons
  .claude/         # Claude Code configuration and skill files
```

## Key Context

- **Language**: Audio content is in **Bulgarian**. All transcript processing must handle Bulgarian text, encoding (UTF-8), and language-specific tooling.
- **Speaker diarization**: Transcripts must differentiate between different speakers. Use speaker diarization techniques to label and separate speakers (e.g., Speaker 1, Speaker 2, etc.).
- **Audio folder**: Contains source audio files and extraction scripts/results for Bulgarian transcript processing.

## Conventions

- File names should use snake_case.
- Transcripts should be stored as structured text (e.g., JSON or SRT) with speaker labels and timestamps.
- Keep raw audio files separate from processed outputs.

## Tools & Dependencies

- Whisper (or similar ASR) for speech-to-text with Bulgarian language support.
- Speaker diarization library (e.g., pyannote-audio, resemblyzer) for multi-speaker identification.
- ffmpeg for audio extraction and format conversion.
