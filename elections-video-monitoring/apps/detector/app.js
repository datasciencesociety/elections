'use strict';

// ── DOM refs ───────────────────────────────────────────────────────────────
const elUrl          = document.getElementById('stream-url');
const btnStart       = document.getElementById('btn-start');
const btnStop        = document.getElementById('btn-stop');
const statusPanel    = document.getElementById('status-panel');
const statusIcon     = document.getElementById('status-icon');
const statusText     = document.getElementById('status-text');
const statusSub      = document.getElementById('status-sub');
const video          = document.getElementById('video');
const canvas         = document.getElementById('canvas');
const ctx            = canvas.getContext('2d');
const mLastCheck     = document.getElementById('m-last-check');
const mLuma          = document.getElementById('m-luma');
const mDiff          = document.getElementById('m-diff');
const mCover         = document.getElementById('m-cover');
const mFrozen        = document.getElementById('m-frozen');
const mRectime       = document.getElementById('m-rectime');
const alertLog       = document.getElementById('alert-log');
const btnCopyLog     = document.getElementById('btn-copy-log');
const btnClearLog    = document.getElementById('btn-clear-log');
const btnResetConfig = document.getElementById('btn-reset-config');
const btnTestNotif   = document.getElementById('btn-test-notif');
const cfgInterval    = document.getElementById('cfg-interval');
const cfgFreezeMin   = document.getElementById('cfg-freeze-min');
const cfgMotion      = document.getElementById('cfg-motion-threshold');
const cfgMotionVal   = document.getElementById('cfg-motion-val');
const cfgCoverArea   = document.getElementById('cfg-cover-area');
const cfgCoverDur    = document.getElementById('cfg-cover-duration');
const cfgCoverVar    = document.getElementById('cfg-cover-variance');
const cfgCoverVarVal = document.getElementById('cfg-cover-var-val');
const cfgLowCpu      = document.getElementById('cfg-low-cpu');
const cfgNotif       = document.getElementById('cfg-notif');

// ── Constants ──────────────────────────────────────────────────────────────
const DEFAULTS = {
  interval: 1, freezeSec: 300, motionThreshold: 5,
  coverArea: 50, coverDuration: 30, coverVariance: 40,
  lowCpu: false, notif: false,
};
// ── State ──────────────────────────────────────────────────────────────────
let hls             = null;
let checkTimer      = null;
let lastFrameData   = null;
let lastChangeTime  = null;   // last time motion was detected
let coverStartTime  = null;   // when cover condition first met
let monitoring      = false;
let retryCount      = 0;
const MAX_RETRIES   = 3;
let logEntries      = [];     // { time, level, msg }
let frameMediaTime  = null;   // last frame PTS from requestVideoFrameCallback


function scheduleFrameCallback() {
  if (!video.requestVideoFrameCallback) return;
  video.requestVideoFrameCallback((_, meta) => {
    frameMediaTime = meta.mediaTime;
    if (monitoring) scheduleFrameCallback();
  });
}

// ── Settings ───────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('fzd_settings') || '{}');
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}

function saveSettings() {
  const s = readSettings();
  localStorage.setItem('fzd_settings', JSON.stringify(s));
}

function readSettings() {
  return {
    interval:        Number(cfgInterval.value),
    freezeSec:       Number(cfgFreezeMin.value),
    motionThreshold: Number(cfgMotion.value),
    coverArea:       Number(cfgCoverArea.value),
    coverDuration:   Number(cfgCoverDur.value),
    coverVariance:   Number(cfgCoverVar.value),
    lowCpu:          cfgLowCpu.checked,
    notif:           cfgNotif.checked,
  };
}

function applySettings(s) {
  cfgInterval.value  = s.interval;
  cfgFreezeMin.value = s.freezeSec;
  cfgMotion.value    = s.motionThreshold;
  cfgMotionVal.textContent = s.motionThreshold;
  cfgCoverArea.value = s.coverArea;
  cfgCoverDur.value  = s.coverDuration;
  cfgCoverVar.value  = s.coverVariance;
  cfgCoverVarVal.textContent = s.coverVariance;
  cfgLowCpu.checked  = s.lowCpu;
  cfgNotif.checked   = s.notif;
}

cfgMotion.addEventListener('input', () => { cfgMotionVal.textContent = cfgMotion.value; saveSettings(); });
cfgCoverVar.addEventListener('input', () => { cfgCoverVarVal.textContent = cfgCoverVar.value; saveSettings(); });
[cfgInterval, cfgFreezeMin, cfgCoverArea, cfgCoverDur, cfgLowCpu, cfgNotif]
  .forEach(el => el.addEventListener('change', saveSettings));

btnResetConfig.addEventListener('click', () => { applySettings(DEFAULTS); saveSettings(); });

// ── Log ────────────────────────────────────────────────────────────────────
function addLog(msg, level = 'info') {
  const time = new Date().toLocaleTimeString();
  logEntries.push({ time, level, msg });
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<span class="log-time">${time}</span>${escHtml(msg)}`;
  alertLog.prepend(entry);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

btnCopyLog.addEventListener('click', () => {
  const text = logEntries.map(e => `[${e.time}] [${e.level.toUpperCase()}] ${e.msg}`).join('\n');
  navigator.clipboard.writeText(text).catch(() => {});
});
btnClearLog.addEventListener('click', () => { alertLog.innerHTML = ''; logEntries = []; });

// ── Notifications ──────────────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

async function sendNotif(title, body) {
  const s = readSettings();
  if (!s.notif) return;
  if (await requestNotifPermission()) {
    new Notification(title, { body, icon: '' });
  }
}

btnTestNotif.addEventListener('click', async () => {
  if (await requestNotifPermission()) {
    sendNotif('Test Notification', 'Notifications are working!');
  } else {
    addLog('Notification permission denied', 'warn');
  }
});

// ── Status helpers ─────────────────────────────────────────────────────────
function setStatus(state, icon, text, sub = '') {
  statusPanel.className = `status-${state}`;
  statusIcon.textContent = icon;
  statusText.textContent = text;
  statusSub.textContent  = sub;
}

// ── Detection ──────────────────────────────────────────────────────────────
function checkFrame() {
  if (video.ended) {
    // Keep all metric cards in frozen state; status was already set by 'ended' handler
    mFrozen.closest('.metric').classList.add('breach-frozen');
    mDiff.closest('.metric').classList.add('breach-frozen');
    return;
  }
  if (video.readyState < 2) return;

  const s = readSettings();

  // Canvas size (low-cpu mode)
  const W = s.lowCpu ? 160 : 320;
  const H = s.lowCpu ? 90  : 180;
  if (canvas.width !== W)  canvas.width  = W;
  if (canvas.height !== H) canvas.height = H;

  ctx.drawImage(video, 0, 0, W, H);
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, W, H);
  } catch (e) {
    addLog(`CORS/SecurityError: canvas read blocked — ${e.message}`, 'alert');
    return;
  }
  const data = imageData.data;
  const now  = Date.now();

  // ── 1. Luminance (no-signal) ─────────────────────────────────────────────
  const luma = computeLuminance(data);

  // ── 2. Motion diff (freeze) ──────────────────────────────────────────────
  let diff = null;
  if (lastFrameData && lastFrameData.length === data.length) {
    diff = computeDiff(lastFrameData, data);
    if (diff > s.motionThreshold) lastChangeTime = now;
  } else {
    lastChangeTime = now;
  }
  lastFrameData = new Uint8ClampedArray(data);

  const frozenMs  = lastChangeTime ? now - lastChangeTime : 0;
  const frozenSec = frozenMs / 1000;

  // ── 3. Cover detection ───────────────────────────────────────────────────
  const coverRatio = computeCoverRatio(data, W, H, s.coverVariance);
  const coverAreaFrac = s.coverArea / 100;
  if (coverRatio >= coverAreaFrac) {
    if (!coverStartTime) coverStartTime = now;
  } else {
    coverStartTime = null;
  }
  const coverDurSec = coverStartTime ? (now - coverStartTime) / 1000 : 0;

  // ── Update metrics ───────────────────────────────────────────────────────
  mLastCheck.textContent = new Date().toLocaleTimeString();
  mLuma.textContent      = luma.toFixed(1);
  mDiff.textContent      = diff !== null ? diff.toFixed(2) : '—';
  mCover.textContent     = (coverRatio * 100).toFixed(1) + '%';
  mFrozen.textContent    = frozenSec.toFixed(0) + 's';

  // ── Metric card highlights ───────────────────────────────────────────────
  mLuma.closest('.metric').classList.toggle('breach-dark',   luma < 20);
  mCover.closest('.metric').classList.toggle('breach-cover', coverRatio >= coverAreaFrac);
  mDiff.closest('.metric').classList.toggle('breach-frozen', diff !== null && diff <= s.motionThreshold);
  mFrozen.closest('.metric').classList.toggle('breach-frozen', frozenSec >= s.freezeSec);

  const mediaTime = frameMediaTime !== null ? frameMediaTime : video.currentTime;
  const recStart  = parseRecordingStart(elUrl.value);
  if (recStart && mediaTime) {
    const wallTime = new Date(recStart.getTime() + mediaTime * 1000);
    mRectime.textContent = wallTime.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } else {
    mRectime.textContent = mediaTime ? new Date(mediaTime * 1000).toISOString().slice(11, 19) : '—';
  }

  // ── Determine status (cover > freeze > black-frame) ──────────────────────
  if (coverStartTime && coverDurSec >= s.coverDuration) {
    // CAMERA COVERED
    setStatus('covered', '🎥', '🚨 CAMERA COVERED',
      `${(coverRatio*100).toFixed(0)}% of frame covered for ${coverDurSec.toFixed(0)}s`);
    addLog(`CAMERA COVERED — ${(coverRatio*100).toFixed(0)}% covered, ${coverDurSec.toFixed(0)}s`, 'alert');
    sendNotif('🚨 Camera Covered', `${(coverRatio*100).toFixed(0)}% of frame covered for ${coverDurSec.toFixed(0)}s`);
  } else if (coverStartTime && coverDurSec > 0) {
    setStatus('warn', '🎥', 'Possible Camera Cover',
      `${(coverRatio*100).toFixed(0)}% covered for ${coverDurSec.toFixed(0)}s (threshold: ${s.coverDuration}s)`);
  } else if (luma < 20) {
    // NO SIGNAL
    setStatus('dark', '⬛', '🚨 NO SIGNAL',
      `Average luminance: ${luma.toFixed(1)} (threshold: 20)`);
    addLog(`NO SIGNAL — luminance ${luma.toFixed(1)}`, 'alert');
    sendNotif('🚨 No Signal', `Stream luminance dropped to ${luma.toFixed(1)}`);
  } else if (frozenSec >= s.freezeSec) {
    // FROZEN
    setStatus('frozen', '🥶', '🚨 FROZEN / NO MOVEMENT',
      `No movement for ${frozenSec.toFixed(0)}s`);
    addLog(`FROZEN — no movement for ${frozenSec.toFixed(0)}s`, 'alert');
    sendNotif('🚨 Stream Frozen', `No movement detected for ${frozenSec.toFixed(0)}s`);
  } else if (frozenSec > s.freezeSec * 0.7) {
    // Approaching freeze threshold
    setStatus('warn', '⚠️', 'Approaching Freeze Threshold',
      `No movement for ${frozenSec.toFixed(0)}s (threshold: ${s.freezeSec}s)`);
  } else {
    // OK
    setStatus('ok', '✅', 'Stream OK', `Last checked: ${new Date().toLocaleTimeString()}`);
  }
}

// ── Stream loading ─────────────────────────────────────────────────────────
function startMonitoring() {
  const url = elUrl.value.trim();
  if (!url) { addLog('Please enter a stream URL', 'warn'); return; }

  stopMonitoring();
  retryCount  = 0;
  monitoring  = true;
  lastFrameData  = null;
  lastChangeTime = null;
  coverStartTime = null;
  frameMediaTime = null;

  btnStart.disabled = true;
  btnStop.disabled  = false;
  setStatus('idle', '⏳', 'Connecting…', url);
  addLog(`Starting stream: ${url}`, 'info');

  loadStream(url);
}

function loadStream(url) {
  // Route archive.evideo.bg through a CORS proxy so canvas.getImageData() works.
  // When served under the coordinator (/inspect), use its /proxy/ route;
  // otherwise fall back to the standalone proxy on localhost:8788.
  if (/^https?:\/\/archive\.evideo\.bg/i.test(url)) {
    const isCoordinator = location.pathname.startsWith('/inspect');
    const proxyBase = isCoordinator
      ? location.origin + '/proxy'
      : 'http://localhost:8788';
    url = proxyBase + url.replace(/^https?:\/\/[^/]+/, '');
  }
  const isHls = url.includes('.m3u8') || url.includes('hls');

  if (typeof Hls !== 'undefined' && Hls.isSupported() && isHls) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(e => addLog(`Autoplay blocked: ${e.message} — click the video to start`, 'warn'));
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        handleStreamError(`HLS fatal error: ${data.type} / ${data.details}`);
      }
    });
  } else {
    // Native HLS (Safari) or direct video
    video.src = url;
    video.play().catch(e => addLog(`Autoplay blocked: ${e.message} — click the video to start`, 'warn'));
  }

  video.addEventListener('loadeddata', onVideoReady, { once: true });
  video.addEventListener('error', onVideoError);
}

function onVideoReady() {
  addLog('Stream loaded — monitoring started', 'ok');
  setStatus('ok', '✅', 'Stream OK', 'Monitoring active');
  const s = readSettings();
  checkTimer = setInterval(checkFrame, s.interval * 1000);
  scheduleFrameCallback();
}

function onVideoError() {
  const msg = video.error ? video.error.message : 'Unknown video error';
  handleStreamError(`Video error: ${msg}`);
}

function handleStreamError(msg) {
  if (!monitoring) return;
  addLog(msg, 'alert');
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    const delay = 30;
    addLog(`Retrying in ${delay}s… (attempt ${retryCount}/${MAX_RETRIES})`, 'warn');
    setStatus('warn', '🔄', `Connection error — retrying (${retryCount}/${MAX_RETRIES})`, msg);
    clearInterval(checkTimer);
    setTimeout(() => {
      if (monitoring) {
        if (hls) { hls.destroy(); hls = null; }
        loadStream(elUrl.value.trim());
      }
    }, delay * 1000);
  } else {
    setStatus('error', '❌', 'Stream Unavailable', msg);
    addLog(`Max retries reached — stopped`, 'alert');
    sendNotif('❌ Stream Unavailable', msg);
    stopMonitoring(false);
  }
}

function stopMonitoring(resetStatus = true) {
  monitoring = false;
  clearInterval(checkTimer);
  checkTimer = null;
  if (hls) { hls.destroy(); hls = null; }
  video.src         = '';
  video.removeEventListener('error', onVideoError);
  btnStart.disabled = false;
  btnStop.disabled  = true;
  if (resetStatus) setStatus('idle', '⏸', 'Idle — enter a URL to begin');
}

// ── Handle paused / stalled video ─────────────────────────────────────────
video.addEventListener('pause', () => {
  if (monitoring) {
    video.play().catch(() => {});
  }
});
video.addEventListener('stalled', () => {
  if (monitoring) addLog('Stream stalled', 'warn');
});
video.addEventListener('ended', () => {
  if (!monitoring) return;
  const dur = video.duration;
  const seekTo = Number(new URLSearchParams(location.search).get('t'));
  const beyondEnd = seekTo && dur && seekTo > dur;
  const msg = beyondEnd
    ? `Requested t=${seekTo}s is past stream end (duration: ${dur.toFixed(1)}s)`
    : `Stream ended at ${dur ? dur.toFixed(1) + 's' : '?'}`;
  addLog(msg, 'alert');
  setStatus('frozen', '🥶', '🚨 STREAM ENDED', msg);
  sendNotif('🚨 Stream Ended', msg);
});

// ── Controls ───────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startMonitoring);
btnStop.addEventListener('click', () => { stopMonitoring(); addLog('Monitoring stopped by user', 'info'); });


elUrl.addEventListener('keydown', e => { if (e.key === 'Enter') startMonitoring(); });

// ── Init ───────────────────────────────────────────────────────────────────
(function init() {
  if (!('Notification' in window)) cfgNotif.disabled = true;
  applySettings(loadSettings());
  addLog('Stream Freeze Detector ready', 'info');

  // Detect iframe embedding for tighter mobile layout
  if (window !== window.top) document.body.classList.add('in-iframe');

  const params = new URLSearchParams(location.search);
  const urlParam = params.get('url');
  const tParam   = params.get('t');
  if (urlParam) {
    elUrl.value = urlParam;
    if (tParam) {
      const seekTo = Number(tParam);
      video.addEventListener('loadedmetadata', () => { video.currentTime = seekTo; }, { once: true });
    }
    startMonitoring();
  }
})();
