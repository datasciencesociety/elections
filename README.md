# Video Preprocessing Metrics

Tools for benchmarking and monitoring video stream quality using frame-level metrics.

## Overview

This project provides:

- **Stream analyzer** — connects to RTSP streams, samples frames, and classifies each stream as `FROZEN`, `STATIC`, or `NORMAL` using pixel-level metrics (MSE, histogram L1, optional SSIM)
- **Benchmark notebook** — `benchmark_video_validity.ipynb` for offline analysis of video validity metrics
- **MediaMTX config generator** — `generate_mediamtx_config.py` for generating stream proxy configs

## Metrics

| Metric | Description |
|--------|-------------|
| `pixel_mse` (stride 1 & 10) | Mean squared error between consecutive frames |
| `histogram_l1` (stride 1 & 10) | L1 distance between frame histograms |
| `SSIM` (optional) | Structural similarity index |

## Video Source Folder

The `videos/` directory is the local source for test and benchmark footage. It is **not tracked by git** (excluded via `.gitignore`).

Structure:

```text
videos/
├── raw/                        # Raw per-camera footage, organised by camera ID
│   └── <camera_id>/            # e.g. 234602001/, 234610032/, ...
├── normal_samples/             # Trimmed 5-minute normal clips used for benchmarking
│   ├── _cut.sh                 # Script that generates the trimmed clips (see below)
│   └── normal_<camera_id>.mp4
├── blocked_table_visibility.mp4
├── hand_cover.mp4
├── misplaced_camera_*.mp4
└── paper_cover.mp4
```

When running the streaming stack locally, the publisher service reads videos from this folder and pushes them to MediaMTX as RTSP streams.

### Trimming Normal Samples

**Prerequisites:** [`ffmpeg`](https://ffmpeg.org/download.html) must be installed and available on `PATH`.

```bash
# macOS
brew install ffmpeg
```

The script `videos/normal_samples/_cut.sh` trims a 300-second (5-minute) clip from each raw camera file at a manually chosen start offset (to avoid frozen/anomaly segments), running all cuts in parallel:

```bash
bash videos/normal_samples/_cut.sh
```

Each `ffmpeg` call uses `-c copy` (no re-encoding) so trimming is fast. The script prints `All done.` once all background jobs finish.

## Streaming Stack

The `streaming/` directory contains a Docker Compose setup with:

- **MediaMTX** — RTSP proxy/relay
- **Analyzer** — metric computation service, exposes results as an RSS 2.0 feed on HTTP port 8080
- **Frontend** — web UI for monitoring stream health

### Running

```bash
cd streaming
docker-compose up
```

Configure streams in `streaming/streams.json`.

### Analyzer Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEDIAMTX_HOST` | `mediamtx` | MediaMTX hostname |
| `MEDIAMTX_PORT` | `8554` | RTSP port |
| `SAMPLE_FRAMES` | `10` | Frames sampled per interval |
| `SAMPLE_INTERVAL` | `30` | Seconds between samples |
| `SMOOTH_WINDOW` | `5` | Samples to average for smoothing |
| `RESIZE_W` / `RESIZE_H` | `256` | Frame resize dimensions |
| `ENABLE_SSIM` | `false` | Enable SSIM computation |
| `HTTP_PORT` | `8080` | RSS feed port |

## Requirements

```bash
pip install -r requirements.txt
```

Key dependencies: PyTorch, OpenCV, kornia, torchvision, Jupyter.
