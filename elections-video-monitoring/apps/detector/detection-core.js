'use strict';

// ── Detection grid ──────────────────────────────────────────────────────────
const COLS = 16;
const ROWS = 9;

// ── Shared detection algorithms ─────────────────────────────────────────────

function computeLuminance(data) {
  let sum = 0;
  const len = data.length;
  for (let i = 0; i < len; i += 4) sum += (data[i] + data[i+1] + data[i+2]) / 3;
  return sum / (len / 4);
}

function computeDiff(a, b) {
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i += 4) {
    sum += (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3;
  }
  return sum / (len / 4);
}

// varianceThreshold: cells below this variance are considered "covered"
function computeCoverRatio(data, w, h, varianceThreshold) {
  const cellW = w / COLS, cellH = h / ROWS;
  let covered = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = Math.floor(col * cellW), y0 = Math.floor(row * cellH);
      const x1 = Math.floor((col+1) * cellW), y1 = Math.floor((row+1) * cellH);
      let ls = 0, ls2 = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const luma = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
          ls += luma; ls2 += luma*luma; n++;
        }
      }
      if (n === 0) continue;
      const mean = ls / n;
      if ((ls2 / n) - mean * mean < varianceThreshold) covered++;
    }
  }
  return covered / (COLS * ROWS);
}

// Parse wall-clock start time encoded in evideo.bg filenames:
//   …_20260222_200022_96.mp4  →  2026-02-22T20:00:22
function parseRecordingStart(url) {
  const m = url.match(/(\d{8})_(\d{6})/);
  if (!m) return null;
  const [, d, t] = m;
  const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
  const dt = new Date(iso);
  return isNaN(dt) ? null : dt;
}
