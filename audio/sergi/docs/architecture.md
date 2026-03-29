# Video Streaming Analysis — Technical Documentation

## 1. Problem Statement

Analyze Bulgarian election committee meeting video recordings to:
- Identify and separate individual speakers (diarization)
- Transcribe what each person says, including faint background speech (ASR)
- Identify speaker roles (Chair, Committee Member, Observer, etc.)
- Extract election-specific KPIs (vote tallies, partisan language, tension level)
- Correct transcription errors using LLM post-processing

## 2. Solution Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         INPUT                                 │
│  Video (MP4) ── ffmpeg -ss START -t DURATION ──► WAV 16kHz   │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                   PREPROCESSING                               │
│                                                               │
│  Smart Hybrid Filtering:                                      │
│  ┌────────────────────┐  ┌──────────────────────────────┐    │
│  │ Per-second RMS scan │─▶│ RMS < 0.015: raw + 8x boost  │    │
│  │                    │  │ RMS >= 0.015: Multi-Band AGC  │    │
│  └────────────────────┘  └──────────────────────────────┘    │
│                                                               │
│  Multi-Band AGC:                                              │
│    Low  (80-300Hz)   → AGC target 0.02                       │
│    Mid  (300-3500Hz) → AGC target 0.07 (strongest boost)     │
│    High (3500-7500Hz)→ AGC target 0.03                       │
│                                                               │
│  + Loudness normalization (-16 LUFS)                          │
└──────────┬───────────────────────────┬───────────────────────┘
           │                           │
     RAW audio                   FILTERED audio
     (diarization)               (transcription)
           │                           │
           ▼                           ▼
┌─────────────────────┐  ┌────────────────────────────────────┐
│ SPEAKER DIARIZATION │  │ THREE-PASS TRANSCRIPTION            │
│                     │  │                                     │
│ pyannote.audio 3.1  │  │ Pass 1: Full filtered file          │
│ on RAW audio        │  │   └─ Groq API (Whisper large-v3)    │
│ min_speakers=4      │  │   └─ Best context, bulk content     │
│                     │  │                                     │
│ Output:             │  │ Pass 2: Sparse region recovery      │
│ Who speaks when     │  │   └─ Detect sparse: < 5 chars/sec   │
│                     │  │   └─ Volume-jump split (RMS > 0.06) │
│                     │  │   └─ Try 4 techniques per region:   │
│                     │  │       raw08, raw12, sbagc, agc       │
│                     │  │   └─ Auto-select most chars          │
│                     │  │                                     │
│                     │  │ Pass 3: Boosted-VAD recovery         │
│                     │  │   └─ 5x audio boost before VAD      │
│                     │  │   └─ Threshold 0.3 (vs normal 0.5)  │
│                     │  │   └─ Speech-band AGC on faint chunks │
│                     │  │   └─ Only uncovered regions          │
└────────┬────────────┘  └──────────────┬──────────────────────┘
         │                              │
         └──────────┬───────────────────┘
                    ▼
           ┌────────────────┐
           │ MERGE + DIARIZE│
           │ Assign speakers│
           │ by timestamp   │
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │ LLM CORRECTION │
           │                │
           │ Claude Sonnet  │
           │                │
           │ Fix garbled BG:│
           │ осеми → осем   │
           │ номери → номера│
           │ Remove halluc  │
           │ Preserve intent│
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │ LLM ANALYSIS   │
           │                │
           │ Claude Sonnet  │
           │                │
           │ • Speaker roles│
           │ • Tension 1-5  │
           │ • Number matrix│
           │ • Vote tallies │
           │ • Names        │
           │ • Наши/Ваши    │
           │ • Невалидни    │
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │ OUTPUT          │
           │                │
           │ • Dashboard    │
           │ • Unified TXT  │
           │ • SRT subtitles│
           │ • JSON results │
           │ • Waveform PNG │
           └────────────────┘
```

## 3. Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Audio extraction | ffmpeg | system | Extract WAV from video, time ranges |
| Noise reduction | noisereduce | 3.0.3 | Spectral gating |
| Loudness normalization | pyloudnorm | 0.2.0 | EBU R128 to -16 LUFS |
| VAD | Silero VAD | torch.hub | Voice activity detection (boosted mode) |
| Speaker diarization | pyannote.audio | 4.0.4 | Speaker identification |
| ASR (primary) | Groq API | Whisper large-v3 | Free cloud transcription |
| ASR (fallback) | faster-whisper | 1.2.1 | Local CPU (int8 quantized) |
| Transcript correction | Claude API | Sonnet | Fix ASR errors using context |
| Role + KPI analysis | Claude API | Sonnet | Speaker roles, election KPIs |
| Dashboard | HTML + JS | standalone | Interactive comparison |
| Language | Python | 3.10 | All processing |

## 4. Three-Pass Transcription Architecture

### Why Three Passes?

Single-pass transcription misses faint speech because:
1. Whisper's internal VAD skips quiet sections when loud speech exists in the same file
2. Per-file normalization can't optimize for both loud and faint sections simultaneously
3. Faint conversational speech (e.g., "осем, имаме ли?") needs different enhancement than normal speech

### Pass 1: Full Filtered File

```
Input:  Filtered audio (Smart Hybrid: Multi-Band AGC + raw boost)
Model:  Groq API (Whisper large-v3)
Output: ~2500 chars, bulk of the transcript
Strength: Best context — Whisper uses surrounding speech to improve accuracy
Weakness: Misses faint sections (< 0.02 RMS)
```

### Pass 2: Sparse Region Recovery

```
Detection: Find Pass 1 segments with < 5 chars/second (suspiciously sparse)
Split:     At volume jumps (RMS > 0.06) to isolate quiet from loud parts
Extract:   From RAW audio (not filtered — preserves faint speech features)

Multi-technique auto-selection:
  ┌─────────────┐
  │ raw08       │── normalize to RMS 0.08
  │ raw12       │── normalize to RMS 0.12
  │ sbagc       │── speech band (200-4kHz) + per-200ms AGC
  │ agc         │── full-band per-200ms AGC
  └─────────────┘
         │
    Transcribe each with Groq
         │
    Pick the one with MOST CHARACTERS
```

### Pass 3: Boosted-VAD Recovery

```
Problem: Normal VAD (threshold 0.5) misses very faint speech (RMS < 0.015)
Solution: Boost audio 5x BEFORE VAD, lower threshold to 0.3

Pipeline:
  Raw audio × 5.0 → Silero VAD (threshold=0.3) → speech segments
       │
  For each segment NOT covered by Pass 1+2:
       │
  RMS < 0.025? → Speech-band AGC (200-4kHz, target 0.07, max 12x)
  RMS >= 0.025? → Simple normalize to 0.08
       │
  Transcribe with Groq → merge
```

### Results Progression

```
Approach                        Chars  Numbers  Faint Speech
─────────────────────────────────────────────────────────────
Combo A (NR + Norm)              2004       52  Nothing
Smart Hybrid                     2357       89  Nothing
Multi-Band AGC                   2076       67  Nothing
Three-Pass + LLM correction      2825       94  "осем, номера ли?"
                                                "десет, има ли още?"
                                                "имам ли някъде 6?"
```

## 5. LLM Transcript Correction

### Purpose

Whisper produces garbled Bulgarian text, especially for faint speech. Claude corrects these errors using linguistic context.

### Common Corrections

| ASR Output | Corrected | Type |
|-----------|-----------|------|
| осеми | осем | Garbled number |
| номери ли | номера ли | Grammar |
| осемайсет | осемнадесет | Number word |
| семината | седемнадесет | Misheard number |
| Абонирайте се | --- (removed) | Hallucination |
| repairs in | --- (removed) | English hallucination |
| По себе | По-себе | Spacing |

### Prompt Design

```
System: "You are an expert editor of Bulgarian election committee
        meeting transcripts. Fix garbled words, misheard numbers,
        remove hallucinations. Preserve timestamps and meaning."

Input:  Raw transcript with [MM:SS.SS] SPEAKER_XX: format
Output: Same format with corrected text
```

### Rules

- Keep `[timestamp] SPEAKER_XX:` prefix unchanged
- Only fix text after the colon
- If a line is pure noise/hallucination, output `---`
- This is a vote counting session — expect numbers and "имаме ли" questions
- Don't invent content — only fix what's garbled

## 6. Audio Preprocessing

### Tested Techniques (NB03 — 15 approaches)

| # | Technique | Result on Election Video |
|---|-----------|------------------------|
| 1 | Noise Reduction | 2001 chars, 0% halluc |
| 2 | VAD Trimming | 806 chars, loses content |
| 3 | Loudness Normalization | 2416 chars, 0.8% halluc |
| 4 | High-Pass + De-Essing | 2207 chars, 0% halluc |
| 5 | Dynamic Range Compression | 2093 chars, 0% halluc |
| 6 | Bandpass + Pre-Emphasis | 1641 chars, 0% halluc |
| 7 | Adaptive VAD | 903 chars, 3.8% halluc - BAD |
| 8 | **AGC 200ms** | 1993 chars, 0% halluc |
| 9 | **Speech-Band Boost + Compression** | 2413 chars, 0% halluc |
| 10 | **Multi-Band AGC** | **2538 chars, 0% halluc — BEST** |
| A | NR + Normalization | 2210 chars, 0.4% halluc |
| B | Studio chain | 2136 chars, 0% halluc |
| C | Full Pipeline | 1659 chars, 0% halluc |
| D | HP + Adaptive + Norm | 742 chars, 0% halluc |
| E | NR + AGC + Boost + Norm | 2350 chars, 0% halluc |

### Key Finding: Filtering Depends on Audio Quality

| Audio Quality | Best Filter | Why |
|--------------|------------|-----|
| Low bitrate (64 kbps) | Combo C (Full Pipeline) | Aggressive filtering removes hallucinations |
| Medium/High (AAC/WAV) | Smart Hybrid (Multi-Band AGC) | Light processing preserves content |
| Faint speech sections | SpeechBand AGC or raw boost | Heavy filtering destroys faint speech |

### Faint Speech Recovery (0-12s section study)

15 enhancement approaches tested on isolated 0-12s faint section:

```
Best for most chars:     AGC 200ms target 0.06  (116 chars)
Best for real speech:    SpeechBand AGC          (112 chars) — catches "имаме ли"
Best for context:        Raw norm 0.08           (96 chars)  — catches "Аз сега ще ви кажа"
Worst (hallucinations):  HP+NR+speechBoost       (11 chars)  — just "8 8 8 8 8 8"
```

**Critical insight**: Over-processing faint speech DESTROYS it. Simple normalization or speech-band AGC works better than complex filtering chains.

## 7. Speaker Diarization

### Key Design Decisions

```
✓ Diarize on RAW audio     — filtering destroys speaker voice features
✓ Transcribe on FILTERED   — filtering removes noise that causes hallucinations
✓ min_speakers=4           — prevents merging male/female voices
```

### pyannote 4.x API

```python
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=HF_TOKEN)

# Must pass waveform dict (torchcodec broken on CPU-only systems)
result = pipeline({"waveform": tensor, "sample_rate": 16000}, min_speakers=4)
annotation = result.speaker_diarization  # pyannote 4.x API
for turn, _, speaker in annotation.itertracks(yield_label=True):
    ...
```

### Known Issues

| Issue | Cause | Workaround |
|-------|-------|-----------|
| torchcodec fails | Missing libnvrtc.so.13 | Load audio with scipy, pass as dict |
| Male/female merged | Filtered audio smooths voice features | Diarize on RAW audio |
| OOM with pyannote + Whisper | Both ~6GB each | Release pyannote before loading Whisper |

## 8. LLM Analysis (KPIs)

### Extracted Metrics

| KPI | Description |
|-----|-------------|
| Speaker Roles | Chair, Committee Member, Observer, Device Voice |
| Tension Scale | 1-5 rating with description |
| Number Frequency Matrix | Every number 1-30: count, by speaker, context |
| Candidate Votes | Candidate # → mentions → stated vote count |
| Names Mentioned | Person names with frequency |
| Partisan Language | "Наши"/"Ваши" count per speaker |
| Invalid Votes | "Невалидни" mentions with context |

## 9. Dashboard

### Features

The HTML dashboard (`output/model_comparison/dashboard.html`) includes:

1. **KPI Cards** — Tension, Наши/Ваши, Невалидни, Number count
2. **Number Frequency Matrix** — Visual bars per number, by-speaker breakdown
3. **Vote Tallies** — Candidate → mentions → votes
4. **Names** — Tag cloud
5. **Audio Signal Analysis** — Waveform before/after filtering + zoomed faint section
6. **Full Audio Player**
7. **Unified Transcript** — Scrollable, filterable by speaker, color-coded roles, video timestamps
8. **Model Comparison Table**

Standalone HTML with embedded base64 audio — no server needed.

## 10. Memory Management (15GB System)

```
Step 1: Preprocessing (scipy, noisereduce)          ~1GB
Step 2: pyannote diarization                         ~3GB → del + gc.collect()
Step 3: Groq API calls (three-pass)                  0GB (cloud)
Step 4: Silero VAD (Pass 3)                          ~0.5GB → del
Step 5: Claude API calls (correction + analysis)     0GB (cloud)
Step 6: Dashboard generation                         ~0.5GB

Rule: Never have two large models loaded simultaneously.
```

## 11. Project Structure

```
video_streaming/
├── data/
│   ├── 234602045/                     # Election recordings
│   │   └── pe202410_real_*.mp4        # 1.1GB election video
│   ├── audio1.mp3, audio2.mp3        # Test audio
│   └── shorter.mp4                    # Short test video
│
├── output/
│   ├── model_comparison/              # NB04 outputs
│   │   ├── dashboard.html             # Interactive HTML dashboard
│   │   ├── results.json               # Full analysis + KPIs
│   │   ├── unified_transcript.txt     # Corrected transcript with roles
│   │   ├── unified_transcript.srt     # Subtitle format
│   │   ├── unified_transcript.json    # Structured output
│   │   ├── waveform_comparison.png    # Before/after filtering
│   │   └── waveform_zoom_0to15.png    # Faint speech section
│   └── filtering_comparison/          # NB03 outputs
│
├── scripts/
│   ├── diarize_and_split.py           # CLI diarization pipeline
│   ├── transcribe_local.py            # Local Whisper
│   ├── transcribe_groq.py            # Groq API
│   └── download_video.py             # YouTube downloader
│
├── nbs/
│   ├── 01_transcription.ipynb         # ASR model exploration
│   ├── 02_diarization.ipynb           # Speaker diarization
│   ├── 03_audio_filtering.ipynb       # 15 filtering techniques compared
│   └── 04_model_comparison.ipynb      # Full pipeline + dashboard
│
├── docs/
│   ├── architecture.md                # This file
│   └── bulgarian_asr_ranking.md       # 12 ASR models ranked
│
├── requirements.txt
└── CLAUDE.md
```

## 12. Prerequisites & Setup

```bash
# Python dependencies
pip install faster-whisper pyannote.audio noisereduce pyloudnorm groq anthropic

# API keys
export GROQ_API_KEY='gsk_...'          # console.groq.com (free)
export ANTHROPIC_API_KEY='sk-ant-...'  # console.anthropic.com
export HF_TOKEN='hf_...'              # huggingface.co/settings/tokens

# HuggingFace model licenses (accept on web)
# https://huggingface.co/pyannote/speaker-diarization-3.1
# https://huggingface.co/pyannote/segmentation-3.0
# https://huggingface.co/pyannote/speaker-diarization-community-1
```

## 13. Running the Pipeline

```bash
# Open NB04 in Jupyter
jupyter notebook nbs/04_model_comparison.ipynb

# Or execute from command line
jupyter nbconvert --to notebook --execute --inplace \
    --ExecutePreprocessor.timeout=3600 \
    nbs/04_model_comparison.ipynb

# Change input: edit cell 1 in NB04
VIDEO_FILE = DATA_DIR / "234602045" / "your_video.mp4"
EXTRACT_START = 360    # start time in seconds
EXTRACT_DURATION = 360 # duration in seconds
```

## 14. Lessons Learned

1. **Three-pass beats single-pass** — recovers +40% more content from faint speech
2. **Over-processing faint speech destroys it** — simple normalization or speech-band AGC works better than complex chains
3. **Diarize on raw, transcribe on filtered** — filtering destroys speaker features but helps ASR
4. **Groq API is the best ASR for Bulgarian** — free, 3s, better than local models
5. **LLM correction fixes ASR errors** — Claude understands Bulgarian election context
6. **Volume-jump splitting is critical** — prevents loud device voice from masking faint human speech
7. **Boosted VAD (5x) catches speech normal VAD misses** — threshold 0.3 vs 0.5
8. **Multi-technique auto-selection works** — different regions need different enhancement
9. **Anti-hallucination settings essential** — `condition_on_previous_text=False`
10. **Memory management critical** — never load pyannote + Whisper simultaneously on 15GB
