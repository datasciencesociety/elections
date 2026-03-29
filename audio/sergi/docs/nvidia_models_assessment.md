# NVIDIA ASR Models Assessment

## Models Evaluated
1. **nvidia/parakeet-tdt-0.6b-v3** — 600M params, 12.64% WER on BG FLEURS
2. **nvidia/canary-1b-v2** — 978M params, 9.25% WER on BG FLEURS (best published)

## Results

Both models failed to run on our hardware (16 GB RAM, no GPU):

| Model | Loads? | Transcribes? | Issue |
|---|---|---|---|
| Parakeet (600M) | Yes (uses ~5 GB) | OOM killed | NeMo inference needs >2.3 GB overhead beyond model |
| Canary (978M) | Not attempted | N/A | Even larger, would certainly OOM |

HuggingFace Inference API also not available for these models (not deployed on free serverless).

## Requirements to Run
- **GPU:** NVIDIA with 4+ GB VRAM (recommended: T4 or better)
- **Or:** 32+ GB system RAM for CPU inference
- **Or:** Google Colab (free T4 GPU)

## Recommendation
These models have the best published Bulgarian WER scores (9.25% Canary, 12.64% Parakeet) but require GPU hardware. For our current setup:

- **Use Groq API (Whisper large-v3)** — best practical choice, free, fast, ~98.8% score
- **Try NVIDIA models on Google Colab** if accuracy comparison is needed
- **Canary-1b-v2 on Colab** could potentially beat all our current models (9.25% WER)
