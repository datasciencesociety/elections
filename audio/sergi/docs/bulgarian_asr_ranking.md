# Bulgarian ASR Model Ranking & Comparison

## Scoring Criteria (1-5 scale)

| Criteria | Weight | Description |
|---|---|---|
| **BG Quality** | 30% | Accuracy on Bulgarian speech (WER where available) |
| **Diarization** | 20% | Speaker separation capability (built-in vs external) |
| **Cost** | 15% | Price per hour of audio processed |
| **Speed** | 15% | Processing latency / throughput |
| **Ease of Setup** | 10% | Time to get running, dependencies, complexity |
| **Timestamps** | 10% | Word/segment-level timestamp quality |

---

## Tier 1: Recommended (Weighted Score >= 4.0)

### 1. OpenAI `gpt-4o-transcribe-diarize` API — Score: 4.55

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 5 | State-of-the-art multilingual model |
| Diarization | 5 | **Built-in** speaker diarization, no extra pipeline |
| Cost | 3 | $0.36/hr ($0.006/min) |
| Speed | 5 | Cloud API, fast turnaround |
| Ease of Setup | 5 | Single API call, no infra needed |
| Timestamps | 5 | Word-level timestamps, SRT/VTT output |

**Best for**: Quickest path to production-quality transcripts with speaker labels.
**Limitation**: 25 MB file limit per request (chunk long files). Requires OpenAI API key.

---

### 2. `faster-whisper` large-v3 + pyannote — Score: 4.25

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 5 | Whisper large-v3, best zero-shot BG |
| Diarization | 4 | Via pyannote-audio (separate pipeline, works well) |
| Cost | 5 | Free / open-source (GPU compute only) |
| Speed | 4 | 4-6x faster than vanilla Whisper via CTranslate2 |
| Ease of Setup | 3 | Needs GPU, CUDA, multiple packages |
| Timestamps | 4 | Word-level with forced alignment |

**Best for**: Self-hosted, cost-effective, high-quality pipeline.
**Limitation**: Requires NVIDIA GPU with CUDA. Diarization pipeline adds complexity.

---

### 3. Fine-tuned Whisper BG (`sam8000/whisper-large-v3-turbo-bulgarian-bulgaria`) — Score: 4.10

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 5 | **9.97% WER** on FLEURS BG — best available |
| Diarization | 3 | Needs pyannote separately |
| Cost | 5 | Free / open-source |
| Speed | 4 | Turbo variant (809M params, ~8x faster than large) |
| Ease of Setup | 3 | HuggingFace transformers + pyannote |
| Timestamps | 4 | Via Whisper pipeline |

**Best for**: Maximum Bulgarian accuracy when WER matters most.
**Limitation**: Fine-tuned on FLEURS — may not generalize to all audio domains.

---

## Tier 2: Good Alternatives (Score 3.5 - 3.99)

### 4. Deepgram Nova-3 — Score: 3.85

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 4 | Good BG support since Nov 2025 |
| Diarization | 5 | Built-in, auto-detect speakers |
| Cost | 3 | $0.55/hr ($0.0092/min) |
| Speed | 5 | <300ms real-time |
| Ease of Setup | 5 | Simple REST API |
| Timestamps | 4 | Word-level |

---

### 5. WhisperX (faster-whisper + pyannote + forced alignment) — Score: 3.80

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 5 | Uses Whisper large-v3 backend |
| Diarization | 5 | Integrated pyannote pipeline |
| Cost | 5 | Free / open-source |
| Speed | 3 | Moderate (alignment step adds time) |
| Ease of Setup | 2 | Complex: multiple deps, HF token for pyannote |
| Timestamps | 5 | Best-in-class word-level via forced alignment |

---

### 6. Azure Speech Services — Score: 3.60

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 4 | `bg-BG` supported in GA |
| Diarization | 4 | Built-in for BG |
| Cost | 3 | $0.36-$1.00/hr (batch vs real-time) |
| Speed | 4 | Low latency |
| Ease of Setup | 3 | Azure account + SDK |
| Timestamps | 4 | Word-level |

---

### 7. OpenAI Whisper API (`whisper-1`) — Score: 3.50

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 4 | Good but older than gpt-4o-transcribe |
| Diarization | 1 | None — needs separate solution |
| Cost | 4 | $0.36/hr |
| Speed | 5 | Cloud API |
| Ease of Setup | 5 | Single API call |
| Timestamps | 4 | Word-level |

---

## Tier 3: Viable but Limited (Score < 3.5)

### 8. Google Cloud Speech-to-Text (Chirp-3) — Score: 3.35

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 4 | BG in **Preview** (not GA) on Chirp-3 |
| Diarization | 4 | Built-in (BatchRecognize) |
| Cost | 2 | $0.96/hr (most expensive API) |
| Speed | 4 | Low latency |
| Ease of Setup | 2 | GCP ecosystem overhead |
| Timestamps | 4 | Word-level |

---

### 9. AssemblyAI Universal — Score: 3.25

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 3 | 99+ langs, BG not explicitly benchmarked |
| Diarization | 4 | Add-on ($0.02/hr extra) |
| Cost | 4 | $0.17/hr (cheapest API with diarization) |
| Speed | 4 | Fast |
| Ease of Setup | 4 | Simple REST API |
| Timestamps | 4 | Word-level |

---

### 10. whisper.cpp — Score: 3.10

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 4 | Same Whisper models |
| Diarization | 1 | None |
| Cost | 5 | Free |
| Speed | 3 | Slower than faster-whisper |
| Ease of Setup | 2 | C++ build, WAV-only input |
| Timestamps | 3 | Segment-level |

---

### 11. `anuragshas/whisper-large-v2-bg` — Score: 3.05

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 4 | 13.4% WER on Common Voice 11 |
| Diarization | 1 | None |
| Cost | 5 | Free |
| Speed | 2 | Large-v2 is slow without CTranslate2 |
| Ease of Setup | 3 | HuggingFace transformers |
| Timestamps | 3 | Via pipeline |

---

### 12. wav2vec2 BG models — Score: 2.00

| Criteria | Score | Notes |
|---|---|---|
| BG Quality | 2 | 28-47% WER — significantly worse |
| Diarization | 1 | None |
| Cost | 5 | Free |
| Speed | 4 | Smaller models, fast inference |
| Ease of Setup | 3 | HuggingFace transformers |
| Timestamps | 1 | No native timestamp support |

---

## Visual Ranking

```
Score  Model
4.55   ██████████████████████░░  OpenAI gpt-4o-transcribe-diarize  ★ TOP PICK
4.25   █████████████████████░░░  faster-whisper large-v3 + pyannote
4.10   ████████████████████░░░░  Fine-tuned Whisper BG (sam8000)
3.85   ███████████████████░░░░░  Deepgram Nova-3
3.80   ███████████████████░░░░░  WhisperX
3.60   ██████████████████░░░░░░  Azure Speech Services
3.50   █████████████████░░░░░░░  OpenAI Whisper API (whisper-1)
3.35   ████████████████░░░░░░░░  Google Cloud Chirp-3
3.25   ████████████████░░░░░░░░  AssemblyAI
3.10   ███████████████░░░░░░░░░  whisper.cpp
3.05   ███████████████░░░░░░░░░  whisper-large-v2-bg (anuragshas)
2.00   ██████████░░░░░░░░░░░░░░  wav2vec2 BG models
```

---

## Recommended Approach for This Project

### Phase 1: Baseline (start here)
Use **OpenAI `gpt-4o-transcribe-diarize`** API for quick, high-quality results with built-in speaker diarization. Minimal setup, immediate results.

### Phase 2: Self-hosted alternative
Set up **faster-whisper large-v3 + pyannote** for cost-free processing at scale. Use the fine-tuned `sam8000` model if BG accuracy is critical.

### Phase 3: Optimize
- Compare outputs from Phase 1 vs Phase 2
- Fine-tune on project-specific audio if domain accuracy needs improvement
- Consider WhisperX for best timestamp alignment
