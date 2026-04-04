# Live Stream Freeze / No-Signal Detector – Implementation Spec
**Version:** 1.0  
**Date:** March 28, 2026  
**Project Goal:** Build a pure client-side web app that monitors any CORS-enabled live HLS (or native video) stream, detects “no signal” (black/blank frames) or “frozen / no movement” frames, and alerts the user. Maximum acceptable detection delay: 5 minutes.  
**Target Users:** Stream operators, broadcasters, monitoring dashboards.  
**Tech Stack:** HTML5, vanilla JavaScript (ES2023+), hls.js (CDN), Canvas API. No backend required.  
**Success Criteria:**  
- Works on any modern browser (Chrome/Edge/Firefox/Safari).  
- Detects issues within ≤5 min of occurrence.  
- Zero server-side processing.  
- Easy to copy-paste and host statically (GitHub Pages, Netlify, etc.).

---

## 0. POC – Validate Core Detection Loop (Do This First)

**Goal:** Confirm that canvas frame extraction + black-frame / freeze detection works against a real video before building any UI.

**Test asset:** `https://archive.evideo.bg/le20260222/device-recordings/tour1/real/233900044/le20260222_real_102897_233900044_20260222_200022_96.mp4`

> Note: This is an MP4, not HLS — ideal for POC because it eliminates hls.js as a variable and tests the detection engine in isolation.

### 0.1 Minimal HTML testbed

- [ ] Create a single `poc.html` file (no CSS, no build step).
- [ ] Add a `<video crossorigin="anonymous">` element pointing at the test URL (muted, autoplay).
- [ ] Add a `<canvas>` (320×180) and a `<pre id="log">` for output.

### 0.2 Verify CORS + canvas access

- [ ] In browser devtools, confirm the MP4 response includes `Access-Control-Allow-Origin`.
- [ ] Call `ctx.getImageData()` after first frame renders — confirm no `SecurityError` in console.
- [ ] If CORS is missing on this asset, switch to a local copy (`<video src="local.mp4">`) for the POC — CORS only matters for cross-origin hosted deployments.

### 0.3 Smoke-test black frame detection

- [ ] Log average luminance to `<pre>` every 5 seconds.
- [ ] Seek the video to a known dark segment (or overlay a black div temporarily) and confirm luminance drops below 20.

### 0.4 Smoke-test freeze detection

- [ ] Log per-frame average pixel diff to `<pre>` every 5 seconds.
- [ ] Call `video.pause()` from console — confirm diff drops to ~0 within one check cycle.
- [ ] Call `video.play()` — confirm diff rises again.

### 0.5 Confirm `readyState` guard

- [ ] Log `video.readyState` on the first two check cycles.
- [ ] Confirm no false "NO SIGNAL" fires before `readyState >= 2`.

### 0.6 Smoke-test camera cover detection

- [ ] Seek test video to **27:53** — this is a known camera-covering event in the test asset.
- [ ] Log per-cell variance grid output to `<pre>` (see §3.5 for algorithm).
- [ ] Confirm that ≥50% of cells are flagged as low-variance during the covered interval.
- [ ] Confirm the covered state persists ≥30 s in the video before the alert would fire.
- [ ] Seek away from 27:53 — confirm the covered-cell percentage drops back below 50%.

**POC exit criteria:** luminance and diff values log correctly, no `SecurityError`, no false alert on startup, camera cover correctly identified at 27:53. Only then proceed to §1.

---

## 1. Project Structure (Granular Setup Tasks)

### 1.1 Create repository & basic files
- [ ] Create new Git repository (GitHub/GitLab).
- [ ] Add `.gitignore` for node_modules (if any) and editor files.
- [ ] Create `index.html` (entry point).
- [ ] Create `style.css` (basic Tailwind or plain CSS).
- [ ] Create `app.js` (all logic – will be split later if needed).
- [ ] Create `README.md` with usage instructions and screenshot placeholder.

### 1.2 Add dependencies (CDN only)
- [ ] Include hls.js via CDN (`<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>`).
- [ ] (Optional later) Add lightweight notification library if browser notifications are expanded.

---

## 2. UI / User Experience (Granular Tasks)

### 2.1 Basic layout
- [ ] Header: App title + “Live Stream Freeze Detector”.
- [ ] Input section: Text field for stream URL + “Start Monitoring” button.
- [ ] Live preview area: Small visible `<video>` element (muted, autoplay, controls optional).
- [ ] Status panel: Large colored box showing current state (Idle / Monitoring / ✅ OK / 🚨 NO SIGNAL / 🚨 FROZEN / 🚨 CAMERA COVERED).
- [ ] Configuration panel (collapsible): Check interval (default 30 s), Freeze threshold (5 min), Motion sensitivity slider (0–50), Cover area threshold (default 50%), Cover duration threshold (default 30 s), Cover variance sensitivity (default 40).
- [ ] Footer: “Runs 100% in browser – no data leaves your device”.

### 2.2 Visual feedback
- [ ] Add real-time timestamp of last check.
- [ ] Show “Time frozen” counter (e.g., “No movement for 3.2 min”).
- [ ] Use color coding: green (OK), yellow (approaching threshold), red (alert).
- [ ] Add browser notification permission toggle + test button.

### 2.3 Multi-stream support (Phase 2 – nice-to-have)
- [ ] Allow adding multiple URLs in a list.
- [ ] Tabbed interface or cards for each monitored stream.

---

## 3. Core Detection Engine (Granular Tasks)

### 3.1 Stream loading
- [ ] On button click: validate URL ends with `.m3u8` or is video-compatible.
- [ ] Initialize hidden `<video>` element.
- [ ] If HLS: create `new Hls()`, load source, attach media.
- [ ] Fallback: set `video.src = url` for native HLS/WebRTC.
- [ ] Call `video.play()` and handle autoplay policy errors with user gesture message.

### 3.2 Frame extraction loop
- [ ] Create hidden `<canvas>` (default 320×180 – configurable).
- [ ] Set up `setInterval(checkFrame, CHECK_INTERVAL)` where `CHECK_INTERVAL` = user setting (min 5 s, default 30 s).
- [ ] Inside `checkFrame()`:
  - [ ] Early exit if `video.videoWidth === 0`.
  - [ ] `ctx.drawImage(video, 0, 0, canvas.width, canvas.height)`.
  - [ ] Extract `ImageData` via `ctx.getImageData()`.

### 3.3 No-Signal (Black Frame) detection
- [ ] Compute average luminance: sum of (R+G+B)/3 for all pixels.
- [ ] If average < 20 (configurable threshold), set status to “🚨 NO SIGNAL”.
- [ ] Reset any freeze timer when black frame is detected.

### 3.4 No-Movement (Frozen Frame) detection
- [ ] Store `lastFrameData` as `Uint8ClampedArray` of previous pixels.
- [ ] On first frame: save data and record `lastChangeTime = Date.now()`.
- [ ] On subsequent frames:
  - [ ] Compute average per-pixel RGB difference (simple Manhattan distance).
  - [ ] If average diff > `MOTION_DIFF_THRESHOLD` (default 5):
    - [ ] Update `lastFrameData` and `lastChangeTime`.
    - [ ] Reset status to “✅ Movement detected”.
  - [ ] Else (no movement):
    - [ ] Calculate minutes frozen = `(Date.now() - lastChangeTime) / 60000`.
    - [ ] If minutes ≥ user Freeze threshold (default 5): set “🚨 FROZEN / NO MOVEMENT” alert.
    - [ ] Else: show “No movement for X.X min (still OK)”.

### 3.5 Camera Cover detection

> Detects when a physical object (hand, paper, tape) is placed over the lens, covering ≥50% of the frame for ≥30 seconds. Distinct from black-frame (cover may be any color) and freeze (covered frame has no texture but *may* still show slight movement).

**Algorithm — local variance grid:**

- [ ] Divide the canvas into a **16×9 grid** (144 cells) matching the 16:9 aspect ratio.
- [ ] For each cell, compute the **variance of luma values** across its pixels: `luma = 0.299R + 0.587G + 0.114B`. Variance = mean of squared deviations from cell mean.
- [ ] A cell is "covered" if its variance < `COVER_VARIANCE_THRESHOLD` (default 40 — tunable; lower = more sensitive).
- [ ] Compute `coveredRatio = coveredCells / 144`.
- [ ] If `coveredRatio ≥ 0.50` (configurable):
  - [ ] If `coverStartTime` is unset, record `coverStartTime = Date.now()`.
  - [ ] If `(Date.now() - coverStartTime) / 1000 ≥ COVER_DURATION_THRESHOLD` (default 30 s): set status "🚨 CAMERA COVERED".
  - [ ] Else: show "Possible cover — X s (still OK)".
- [ ] If `coveredRatio < 0.50`: reset `coverStartTime = null` and clear any cover status.

**Interaction with other detectors:**

- [ ] Cover detection runs **independently** — do not suppress it when black-frame or freeze is active. A covered camera may trigger all three; show the most specific alert (cover takes priority over freeze, freeze takes priority over black-frame).
- [ ] The freeze detector (`lastChangeTime`) should still update normally — a covered-but-moving hand should not double-fire as frozen.

**Test reference:** video timestamp 27:53 in the POC asset (see §0.6).

### 3.7 Performance optimizations

- [ ] Downscale canvas to ≤160×90 if user selects “Low CPU” mode.
- [ ] Skip every other pixel in diff calculation (optional toggle).
- [ ] The 16×9 variance grid reuses the same `ImageData` already extracted — no extra `getImageData()` call needed.
- [ ] (Future) Move entire `checkFrame` to a Web Worker to keep UI thread free.

---

## 4. Error Handling & Resilience

### 4.1 Stream errors
- [ ] Listen to `video.error` and `hls.ERROR` events.
- [ ] Show friendly messages: “Stream not found”, “CORS blocked”, “HLS not supported on this browser”.
- [ ] Auto-retry logic: attempt reconnect every 30 s (max 3 attempts).

### 4.2 Browser compatibility
- [ ] Feature detection for HLS and Canvas.
- [ ] Graceful degradation message for very old browsers.

### 4.3 Edge cases
- [ ] Handle paused video (force play).
- [ ] Detect when stream ends (live streams usually don’t).
- [ ] Prevent memory leaks: clear interval on stop button.

---

## 5. Configuration & Persistence

- [ ] Save user settings (interval, thresholds) to `localStorage`.
- [ ] Load settings on page refresh.
- [ ] Add “Reset to defaults” button.

---

## 6. Testing Tasks (Granular)

### 6.1 Unit / manual tests
- [ ] Test with public HLS test streams (e.g., https://test-streams.mux.dev/x264_720p.mp4 – convert to HLS if needed).
- [ ] Manually simulate freeze: pause stream for >5 min.
- [ ] Manually simulate black frame: overlay black div or use a black test stream.
- [ ] Test motion detection with a moving test video.

### 6.2 Browser matrix
- [ ] Chrome, Edge, Firefox, Safari (desktop + mobile).

### 6.3 Performance
- [ ] Measure CPU usage at 30 s interval (should be <5 % on mid-range laptop).
- [ ] Verify detection delay never exceeds 5 min + check interval.

---

## 7. Polish & Deployment

### 7.1 Final UI touches
- [ ] Responsive design (mobile-friendly).
- [ ] Dark/light mode.
- [ ] Copyable log of alerts (timestamped list).

### 7.2 Deployment
- [ ] Add `manifest.json` and PWA support (optional).
- [ ] Deploy to GitHub Pages / Netlify / Vercel (static).
- [ ] Add demo URL in README.

### 7.3 Documentation
- [ ] Update README with:
  - How to get a live HLS URL.
  - Tuning guide for thresholds.
  - Limitations (CORS, autoplay policy).
- [ ] Create `CONTRIBUTING.md` for future extensions.

---

## 8. Phase 2 – Optional Enhancements (After MVP)
- [ ] WebRTC stream support (MediaStreamTrack).
- [ ] Multiple simultaneous streams.
- [ ] Export alert log as CSV.
- [ ] WebSocket push to external dashboard.
- [ ] Advanced metrics (SSIM instead of simple diff).

---

**Implementation Order Recommendation (Smallest → Largest):**
1. Tasks 1.1–1.2 (repo setup)
2. Tasks 2.1 + 3.1–3.2 (basic stream + canvas)
3. Tasks 3.3–3.4 (detection logic)
4. Tasks 2.2 + 4 (UI + error handling)
5. Tasks 5–7 (polish + test + deploy)

Each task above is designed to be **≤30 minutes** for a solo developer. Total estimated effort for MVP: 8–12 hours.

Copy this entire file into `SPEC.md` in your repo and start checking boxes! Let me know which section you want code snippets or a starter template for first.