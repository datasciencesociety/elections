"""
Video stream analyzer.
- Connects to each RTSP stream listed in streams.json
- Every SAMPLE_INTERVAL seconds, grabs SAMPLE_FRAMES consecutive frames
- Runs pixel_mse (stride 1 & 10), histogram_l1 (stride 1 & 10), and
  optionally SSIM (ENABLE_SSIM=true)
- Classifies each stream as FROZEN / STATIC / NORMAL
- Publishes results to an RSS 2.0 feed served on HTTP_PORT
"""

import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from email.utils import format_datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape

import cv2
import numpy as np
import torch
import torch.nn.functional as F

# ── Config ─────────────────────────────────────────────────────────────────────
MEDIAMTX_HOST  = os.environ.get("MEDIAMTX_HOST", "mediamtx")
MEDIAMTX_PORT  = int(os.environ.get("MEDIAMTX_PORT", "8554"))
STREAMS_JSON   = os.environ.get("STREAMS_JSON", "/streams.json")
SAMPLE_FRAMES  = int(os.environ.get("SAMPLE_FRAMES", "10"))
SAMPLE_INTERVAL= int(os.environ.get("SAMPLE_INTERVAL", "30"))   # seconds
SMOOTH_WINDOW  = int(os.environ.get("SMOOTH_WINDOW", "5"))       # samples to average
RESIZE_W       = int(os.environ.get("RESIZE_W", "256"))
RESIZE_H       = int(os.environ.get("RESIZE_H", "256"))
ENABLE_SSIM    = os.environ.get("ENABLE_SSIM", "false").lower() == "true"
HTTP_PORT      = int(os.environ.get("HTTP_PORT", "8080"))
FEED_MAX_ITEMS  = int(os.environ.get("FEED_MAX_ITEMS", "500"))
STREAMS_LIMIT   = int(os.environ.get("STREAMS_LIMIT", "0"))  # 0 = no limit

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("analyzer")

device = torch.device("cpu")

# Force RTSP over TCP and set 10s timeout for all OpenCV captures
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|timeout;10000000"

# ── Analysis functions (from notebook) ─────────────────────────────────────────

def pixel_mse(frames: torch.Tensor, stride: int = 1) -> torch.Tensor:
    stride = min(stride, len(frames) - 1)
    indices = torch.arange(0, len(frames) - stride, stride)
    f1 = frames[indices]
    f2 = frames[indices + stride]
    return torch.mean((f1 - f2) ** 2, dim=(1, 2, 3))


def frame_histograms(frames: torch.Tensor, bins: int = 256) -> torch.Tensor:
    T, C, H, W = frames.shape
    hists = torch.zeros(T, C, bins, device=frames.device)
    for c in range(C):
        channel = frames[:, c].reshape(T, -1)
        for t in range(T):
            h = torch.histc(channel[t], bins=bins, min=0.0, max=1.0)
            hists[t, c] = h / h.sum()
    return hists


def histogram_l1(frames: torch.Tensor, stride: int = 1, bins: int = 256) -> torch.Tensor:
    hists = frame_histograms(frames, bins=bins)
    stride = min(stride, len(frames) - 1)
    indices = torch.arange(0, len(frames) - stride, stride)
    h1, h2 = hists[indices], hists[indices + stride]
    return torch.mean(torch.abs(h1 - h2), dim=(1, 2))


def _gaussian_kernel(window_size: int, sigma: float, channels: int) -> torch.Tensor:
    coords = torch.arange(window_size, dtype=torch.float32) - window_size // 2
    g = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
    g /= g.sum()
    k2d = (g.unsqueeze(1) * g.unsqueeze(0)).unsqueeze(0).unsqueeze(0)
    return k2d.repeat(channels, 1, 1, 1)


def ssim_batch(img1: torch.Tensor, img2: torch.Tensor,
               window_size: int = 11, sigma: float = 1.5,
               C1: float = 0.01 ** 2, C2: float = 0.03 ** 2) -> torch.Tensor:
    _, C, _, _ = img1.shape
    kernel = _gaussian_kernel(window_size, sigma, C).to(img1.device)
    pad = window_size // 2

    def conv(x):
        return F.conv2d(x, kernel, padding=pad, groups=C)

    mu1, mu2 = conv(img1), conv(img2)
    mu1_sq, mu2_sq, mu1_mu2 = mu1 ** 2, mu2 ** 2, mu1 * mu2
    s1 = conv(img1 ** 2) - mu1_sq
    s2 = conv(img2 ** 2) - mu2_sq
    s12 = conv(img1 * img2) - mu1_mu2
    num = (2 * mu1_mu2 + C1) * (2 * s12 + C2)
    den = (mu1_sq + mu2_sq + C1) * (s1 + s2 + C2)
    return (num / den).mean(dim=(1, 2, 3))


def ssim_consecutive(frames: torch.Tensor, batch_size: int = 16) -> torch.Tensor:
    out = []
    T = len(frames)
    for i in range(0, T - 1, batch_size):
        j = min(i + batch_size, T - 1)
        out.append(ssim_batch(frames[i:j], frames[i + 1:j + 1]))
    return torch.cat(out)


def dhash(frames: torch.Tensor, stride: int = 10, hash_size: int = 8) -> torch.Tensor:
    """Difference hash Hamming distance between sampled frame pairs.
    Returns values in [0, 1]: 0 = identical, 1 = completely different.
    """
    stride = min(stride, len(frames) - 1)
    indices = torch.arange(0, len(frames) - stride, stride)
    if len(indices) == 0:
        return torch.tensor([0.0])
    weights = torch.tensor([0.2126, 0.7152, 0.0722], device=frames.device)

    def to_bits(imgs):
        luma = (imgs * weights[None, :, None, None]).sum(dim=1, keepdim=True)
        small = F.adaptive_avg_pool2d(luma, (hash_size, hash_size + 1))
        return (small[:, 0, :, :-1] > small[:, 0, :, 1:]).reshape(len(imgs), -1)

    bits_f = to_bits(frames[indices])
    bits_s = to_bits(frames[torch.clamp(indices + stride, max=len(frames) - 1)])
    return (bits_f != bits_s).float().mean(dim=1)  # (N,)


def frame_darkness(frames: torch.Tensor, stride: int = 10) -> torch.Tensor:
    """Mean luminance of every Nth frame. Lower = darker (0=black, 1=white)."""
    indices = torch.arange(0, len(frames), stride)
    sampled = frames[indices]                                          # (N, C, H, W)
    weights = torch.tensor([0.2126, 0.7152, 0.0722], device=frames.device)
    luma = (sampled * weights[None, :, None, None]).sum(dim=1)        # (N, H, W)
    return luma.mean(dim=(1, 2))                                       # (N,) per-frame brightness


# ── Classification ──────────────────────────────────────────────────────────────

def classify(scores: dict) -> str:
    mse   = scores["pixel_mse_s1"]
    hist  = scores["histogram_l1_s1"]
    dhash = scores.get("dhash_hamming_mean", 0.0)
    ssim  = scores.get("ssim")

    # Frozen / static: too little change
    if mse < 0.002 or hist < 0.0002 or (ssim is not None and ssim > 0.99):
        return "FROZEN"

    # Excessive motion / anomaly: too much change
    if mse > 0.01 or hist > 0.0005 or dhash > 0.35 or (ssim is not None and ssim < 0.9):
        return "MOTION"

    return "NORMAL"


# ── RSS feed ────────────────────────────────────────────────────────────────────

_feed_lock = threading.Lock()
_feed_items: deque = deque(maxlen=FEED_MAX_ITEMS)
_feed_path = Path("/tmp/feed.xml")


def _build_feed() -> str:
    now_rfc = format_datetime(datetime.now(timezone.utc))
    items_xml = "\n".join(_feed_items)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Video Stream Validity Monitor</title>
    <link>http://localhost:{HTTP_PORT}/feed.xml</link>
    <description>Frozen/static camera detection results</description>
    <lastBuildDate>{now_rfc}</lastBuildDate>
    <ttl>1</ttl>
{items_xml}
  </channel>
</rss>"""


def publish_result(stream_id: str, status: str, scores: dict):
    ts = datetime.now(timezone.utc)
    guid = f"{stream_id}-{int(ts.timestamp())}"
    pub_date = format_datetime(ts)
    scores_json = escape(json.dumps(scores, indent=2))
    item = f"""    <item>
      <title>{escape(stream_id)} — {escape(status)}</title>
      <description><![CDATA[<pre>{json.dumps(scores, indent=2)}</pre>]]></description>
      <pubDate>{pub_date}</pubDate>
      <guid>{guid}</guid>
    </item>"""
    with _feed_lock:
        _feed_items.appendleft(item)
        _feed_path.write_text(_build_feed())


# ── HTTP server ─────────────────────────────────────────────────────────────────

class FeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] in ("/feed.xml", "/"):
            content = _feed_path.read_bytes() if _feed_path.exists() else _build_feed().encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/rss+xml; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content if isinstance(content, bytes) else content.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass  # suppress per-request logs


def start_http_server():
    srv = HTTPServer(("0.0.0.0", HTTP_PORT), FeedHandler)
    log.info("RSS feed available at http://0.0.0.0:%d/feed.xml", HTTP_PORT)
    srv.serve_forever()


# ── Stream worker ───────────────────────────────────────────────────────────────

COLLECT_TIMEOUT_S = int(os.environ.get("COLLECT_TIMEOUT_S", "30"))  # max seconds per collection


def _collect_frames(rtsp_url: str) -> list:
    """Open RTSP stream and grab SAMPLE_FRAMES frames. Runs in executor."""
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        return []
    raw_frames = []
    deadline = time.monotonic() + COLLECT_TIMEOUT_S
    while len(raw_frames) < SAMPLE_FRAMES:
        if time.monotonic() > deadline:
            log.warning("_collect_frames timed out after %ds for %s", COLLECT_TIMEOUT_S, rtsp_url)
            break
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame = cv2.resize(frame, (RESIZE_W, RESIZE_H), interpolation=cv2.INTER_AREA)
        raw_frames.append(frame)
    cap.release()
    return raw_frames


def _avg_scores(history: deque) -> dict:
    """Average scalar scores across the rolling window."""
    keys = [k for k, v in history[0].items() if isinstance(v, float)]
    avg = {}
    for k in keys:
        avg[k] = sum(s[k] for s in history) / len(history)
    # carry through the latest per-frame list as-is
    avg["darkness_per_frame"] = history[-1]["darkness_per_frame"]
    return avg


async def analyze_stream(stream_id: str, rtsp_url: str):
    log_s = logging.getLogger(f"stream.{stream_id}")
    log_s.info("Starting — %s", rtsp_url)
    loop = asyncio.get_event_loop()
    history: deque = deque(maxlen=SMOOTH_WINDOW)

    while True:
        # Frame collection is blocking — run in thread pool to keep event loop free
        raw_frames = await loop.run_in_executor(None, _collect_frames, rtsp_url)

        if len(raw_frames) < 2:
            log_s.warning("Too few frames (%d), retrying in 10s", len(raw_frames))
            await asyncio.sleep(10)
            continue

        arr = np.stack(raw_frames, axis=0).astype(np.float32) / 255.0
        frames = torch.from_numpy(arr).permute(0, 3, 1, 2).to(device)

        scores = await loop.run_in_executor(None, _run_methods, frames)
        history.append(scores)

        smoothed = _avg_scores(history)
        status = classify(smoothed)
        log_s.info("status=%s  mse_s1=%.2e  hist_s1=%.2e  darkness=%.3f  (window=%d)",
                   status, smoothed["pixel_mse_s1"], smoothed["histogram_l1_s1"],
                   smoothed["darkness_mean"], len(history))
        publish_result(stream_id, status, smoothed)

        await asyncio.sleep(SAMPLE_INTERVAL)


def _run_methods(frames: torch.Tensor) -> dict:
    darkness_per_frame = frame_darkness(frames, stride=10)
    scores = {
        "pixel_mse_s1":          pixel_mse(frames, stride=1).max().item(),
        "pixel_mse_s10":         pixel_mse(frames, stride=10).max().item(),
        "histogram_l1_s1":       histogram_l1(frames, stride=1).max().item(),
        "histogram_l1_s10":      histogram_l1(frames, stride=10).max().item(),
        "dhash_hamming_mean":     dhash(frames, stride=10).max().item(),
        "darkness_mean":         darkness_per_frame.max().item(),
        "darkness_min":          darkness_per_frame.min().item(),
        "darkness_max":          darkness_per_frame.max().item(),
        "darkness_per_frame":    darkness_per_frame.tolist(),   # one value per 10th frame
    }
    if ENABLE_SSIM:
        scores["ssim"] = ssim_consecutive(frames).mean().item()
    return scores


# ── Entry point ─────────────────────────────────────────────────────────────────

async def main():
    streams_path = Path(STREAMS_JSON)
    if not streams_path.exists():
        raise FileNotFoundError(f"streams.json not found at {STREAMS_JSON}")
    streams = json.loads(streams_path.read_text())
    if STREAMS_LIMIT > 0:
        streams = dict(list(streams.items())[:STREAMS_LIMIT])
    log.info("Loaded %d streams from %s", len(streams), STREAMS_JSON)
    log.info("ENABLE_SSIM=%s  SAMPLE_FRAMES=%d  SAMPLE_INTERVAL=%ds",
             ENABLE_SSIM, SAMPLE_FRAMES, SAMPLE_INTERVAL)

    # Seed the feed file
    _feed_path.write_text(_build_feed())

    # Start HTTP server in background thread
    t = threading.Thread(target=start_http_server, daemon=True)
    t.start()

    # One asyncio task per stream
    tasks = [
        asyncio.create_task(
            analyze_stream(sid, f"rtsp://{MEDIAMTX_HOST}:{MEDIAMTX_PORT}/{sid}")
        )
        for sid in streams
    ]
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
