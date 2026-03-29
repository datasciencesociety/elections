# Audio Analysis Pipeline — Bulgarian Election Committee Meetings

Speaker diarization + transcription + LLM analysis pipeline for Bulgarian election committee video recordings.

## Pipeline

```
Video (MP4) → Audio Extraction → Smart Hybrid Filtering
    → Speaker Diarization (pyannote 3.1)
    → Three-Pass Transcription (Groq Whisper large-v3)
    → LLM Transcript Correction (Claude)
    → LLM KPI Analysis (roles, votes, tension, names)
    → Interactive HTML Dashboard
```

## Key Features

- **Three-pass transcription** recovers faint background speech (+51% more content)
- **Multi-technique auto-selection** for sparse regions (4 enhancement techniques, picks best)
- **Boosted-VAD** (5x audio boost) catches speech normal VAD misses
- **LLM correction** fixes ASR errors using Bulgarian election context
- **Speaker role identification** (Chair, Committee Member, Device Voice)
- **Election KPIs**: number frequency matrix, vote tallies, partisan language, "невалидни"

## Setup

```bash
pip install -r requirements.txt

# API keys (set as environment variables)
export GROQ_API_KEY='gsk_...'          # console.groq.com (free)
export ANTHROPIC_API_KEY='sk-ant-...'  # console.anthropic.com
export HF_TOKEN='hf_...'              # huggingface.co/settings/tokens
```

## Notebooks

| Notebook | Purpose |
|----------|---------|
| `01_transcription.ipynb` | ASR model exploration (Groq, local Whisper, HuggingFace) |
| `02_diarization.ipynb` | Speaker diarization with pyannote |
| `03_audio_filtering.ipynb` | 15 audio filtering techniques compared |
| `04_model_comparison.ipynb` | Full pipeline: preprocess → diarize → transcribe → analyze → dashboard |

## Documentation

See [docs/architecture.md](docs/architecture.md) for full technical documentation.
