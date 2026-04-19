'use strict';

// PROXY_BASE can be overridden by the host page (e.g. coordinator injects
// window.PROXY_BASE = location.origin + '/proxy' before loading this script).
// Default targets the standalone proxy app on its local dev port.
const PROXY_BASE = (typeof window !== 'undefined' && window.PROXY_BASE) || 'http://localhost:8788';

// Volunteer page's iframe fallback sets ?direct=1 to skip the CORS proxy
// (proxy is down or unavailable — user hits evideo directly from their own IP).
// Pixel analysis is disabled in this mode since the canvas will be tainted.
const DIRECT_MODE = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('direct') === '1';

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
const ctx            = canvas.getContext('2d', { willReadFrequently: true });
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
let lastCheckTime   = 0;
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
  const now = new Date();
  const utc = now.toISOString();
  const displayTime = now.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Sofia' });
  logEntries.push({ utc, level, msg });
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<span class="log-time">${displayTime}</span>${escHtml(msg)}`;
  alertLog.prepend(entry);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

btnCopyLog.addEventListener('click', () => {
  const text = logEntries.map(e => `[${e.utc}] [${e.level.toUpperCase()}] ${e.msg}`).join('\n');
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
    sendNotif(t('notif.test'), t('notif.test.body'));
  } else {
    addLog(t('log.notif.denied'), 'warn');
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
    addLog(tf('log.cors', { msg: e.message }), 'alert');
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
  if (!lastFrameData || lastFrameData.length !== data.length) {
    lastFrameData = new Uint8ClampedArray(data);
  } else {
    lastFrameData.set(data);
  }

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
  mLastCheck.textContent = new Date().toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Sofia' });
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
    mRectime.textContent = wallTime.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Sofia' });
  } else {
    mRectime.textContent = mediaTime ? new Date(mediaTime * 1000).toISOString().slice(11, 19) : '—';
  }

  // ── Determine status (cover > freeze > black-frame) ──────────────────────
  if (coverStartTime && coverDurSec >= s.coverDuration) {
    const pct = (coverRatio*100).toFixed(0), cs = coverDurSec.toFixed(0);
    setStatus('covered', '🎥', t('covered.status'),
      tf('covered.detail', { pct, s: cs }));
    addLog(tf('covered.detail', { pct, s: cs }), 'alert');
    sendNotif(t('notif.covered'), tf('covered.detail', { pct, s: cs }));
  } else if (coverStartTime && coverDurSec > 0) {
    setStatus('warn', '🎥', t('covered.warn'),
      tf('covered.warn.detail', { pct: (coverRatio*100).toFixed(0), s: coverDurSec.toFixed(0), dur: s.coverDuration }));
  } else if (luma < 20) {
    setStatus('dark', '⬛', t('dark.status'),
      tf('dark.detail', { luma: luma.toFixed(1) }));
    addLog(tf('dark.detail', { luma: luma.toFixed(1) }), 'alert');
    sendNotif(t('notif.dark'), tf('notif.dark.body', { luma: luma.toFixed(1) }));
  } else if (frozenSec >= s.freezeSec) {
    setStatus('frozen', '🥶', t('frozen.status'),
      tf('frozen.detail', { s: frozenSec.toFixed(0) }));
    addLog(tf('frozen.detail', { s: frozenSec.toFixed(0) }), 'alert');
    sendNotif(t('notif.frozen'), tf('notif.frozen.body', { s: frozenSec.toFixed(0) }));
  } else if (frozenSec > s.freezeSec * 0.7) {
    setStatus('warn', '⚠️', t('freeze.warn'),
      tf('freeze.warn.detail', { s: frozenSec.toFixed(0), dur: s.freezeSec }));
  } else {
    setStatus('ok', '✅', t('stream.ok'), tf('stream.ok.checked', { t: new Date().toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Sofia' }) }));
  }
}

// ── Stream loading ─────────────────────────────────────────────────────────
function startMonitoring() {
  const url = elUrl.value.trim();
  if (!url) { addLog(t('log.no.url'), 'warn'); return; }

  stopMonitoring();
  retryCount  = 0;
  monitoring  = true;
  lastFrameData  = null;
  lastChangeTime = null;
  coverStartTime = null;
  frameMediaTime = null;

  btnStart.disabled = true;
  btnStop.disabled  = false;
  setStatus('idle', '⏳', t('connecting'), url);
  addLog(tf('log.started', { url }), 'info');

  loadStream(url);
}

function loadStream(url) {
  // Route all external (non-same-origin) video URLs through the CORS proxy
  // so canvas.getImageData() is not blocked by cross-origin restrictions.
  // In DIRECT_MODE (volunteer iframe fallback), skip the proxy — we accept
  // a tainted canvas because the proxy is down and we just need the video
  // to play from the user's own IP.
  if (!DIRECT_MODE) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== location.hostname) {
        url = PROXY_BASE + '/' + parsed.hostname + parsed.pathname + parsed.search;
      }
    } catch (_) {
      // Relative or invalid URL — pass through unchanged
    }
  }

  const isHls = url.includes('.m3u8') || url.includes('hls');

  if (typeof Hls !== 'undefined' && Hls.isSupported() && isHls) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(e => addLog(tf('log.autoplay', { msg: e.message }), 'warn'));
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        handleStreamError(tf('log.hls.error', { type: data.type, details: data.details }));
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
  addLog(t('log.loaded'), 'ok');
  setStatus('ok', '✅', t('stream.ok'), t('stream.ok.active'));
  lastCheckTime = 0;
  scheduleCheck();
  scheduleFrameCallback();
}

function scheduleCheck() {
  checkTimer = requestAnimationFrame(ts => {
    if (!monitoring) return;
    const s = readSettings();
    if (ts - lastCheckTime >= s.interval * 1000) {
      lastCheckTime = ts;
      checkFrame();
    }
    scheduleCheck();
  });
}

function onVideoError() {
  const msg = video.error ? video.error.message : 'Unknown video error';
  handleStreamError(tf('log.video.error', { msg }));
}

function handleStreamError(msg) {
  if (!monitoring) return;
  addLog(msg, 'alert');
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    const delay = 30;
    addLog(tf('log.retry', { delay, n: retryCount, max: MAX_RETRIES }), 'warn');
    setStatus('warn', '🔄', tf('retry.status', { n: retryCount, max: MAX_RETRIES }), msg);
    clearInterval(checkTimer);
    setTimeout(() => {
      if (monitoring) {
        if (hls) { hls.destroy(); hls = null; }
        loadStream(elUrl.value.trim());
      }
    }, delay * 1000);
  } else {
    setStatus('error', '❌', t('unavailable'), msg);
    addLog(t('log.maxretry'), 'alert');
    sendNotif(t('notif.unavailable'), msg);
    stopMonitoring(false);
  }
}

function stopMonitoring(resetStatus = true) {
  monitoring = false;
  cancelAnimationFrame(checkTimer);
  checkTimer = null;
  if (hls) { hls.destroy(); hls = null; }
  video.src         = '';
  video.removeEventListener('error', onVideoError);
  btnStart.disabled = false;
  btnStop.disabled  = true;
  if (resetStatus) setStatus('idle', '⏸', t('idle'));
}

// ── Handle paused / stalled video ─────────────────────────────────────────
video.addEventListener('pause', () => {
  if (monitoring) {
    video.play().catch(() => {});
  }
});
video.addEventListener('stalled', () => {
  if (monitoring) addLog(t('log.stalled'), 'warn');
});
video.addEventListener('ended', () => {
  if (!monitoring) return;
  const dur = video.duration;
  const seekTo = Number(new URLSearchParams(location.search).get('t'));
  const beyondEnd = seekTo && dur && seekTo > dur;
  const msg = beyondEnd
    ? tf('ended.beyond', { t: seekTo, dur: dur.toFixed(1) })
    : (dur ? tf('ended.normal', { dur: dur.toFixed(1) }) : t('ended.unknown'));
  addLog(msg, 'alert');
  setStatus('frozen', '🥶', t('ended'), msg);
  sendNotif(t('notif.ended'), msg);
});

// ── Controls ───────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startMonitoring);
btnStop.addEventListener('click', () => { stopMonitoring(); addLog(t('log.stopped'), 'info'); });

document.getElementById('btn-open-url').addEventListener('click', () => {
  const url = elUrl.value.trim();
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
});

elUrl.addEventListener('keydown', e => { if (e.key === 'Enter') startMonitoring(); });

// ── Init ───────────────────────────────────────────────────────────────────
(function init() {
  if (!('Notification' in window)) cfgNotif.disabled = true;
  applySettings(loadSettings());
  addLog(t('log.ready'), 'info');

  // Detect iframe embedding for tighter mobile layout
  if (window !== window.top) document.body.classList.add('in-iframe');

  // Listen for messages from parent (volunteer page)
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.type) return;
    if (window.parent !== window && e.source !== window.parent) return;
    if (e.data.type === 'maximize') {
      document.body.classList.toggle('maximized', !!e.data.value);
      const btn = document.getElementById('btn-maximize-video');
      if (btn) btn.textContent = e.data.value ? '⛌' : '⛶';
      const popup = document.getElementById('phone-popup-video');
      if (popup) popup.classList.remove('open');
    }
    if (e.data.type === 'set-lang' && e.data.lang) {
      _lang = e.data.lang;
      localStorage.setItem('lang', _lang);
      applyTranslations();
    }
  });

  const params = new URLSearchParams(location.search);
  const urlParam = params.get('url');
  const tParam   = params.get('t');
  const audioParam = params.get('audio');
  const cardParam  = params.get('card');

  if (DIRECT_MODE) {
    // No proxy → no CORS headers → crossorigin="anonymous" makes the video
    // refuse to load. Strip it; accept that the canvas becomes tainted.
    video.removeAttribute('crossorigin');
  }
  if (cardParam === '1') {
    // Compact card embed (volunteer grid fallback): no chrome, just <video>.
    document.body.classList.add('card-mode');
  }

  if (audioParam === '1') {
    video.muted = false;
    document.body.classList.add('embedded-mode');

    // Overlay button handlers
    const btnMax = document.getElementById('btn-maximize-video');
    const btnCall = document.getElementById('btn-call-video');
    const phonePopup = document.getElementById('phone-popup-video');

    btnMax.addEventListener('click', () => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'toggle-maximize' }, '*');
      }
    });

    btnCall.addEventListener('click', (e) => {
      e.stopPropagation();
      phonePopup.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (phonePopup.classList.contains('open') && !phonePopup.contains(e.target) && e.target !== btnCall) {
        phonePopup.classList.remove('open');
      }
    });

    // Listen for contacts from parent (volunteer page)
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'contacts') return;
      const contacts = e.data.contacts || [];
      const ul = phonePopup.querySelector('ul');
      if (!ul) return;
      ul.innerHTML = '';
      if (contacts.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-contacts';
        li.setAttribute('data-i18n', 'call.nodata');
        li.textContent = typeof t === 'function' ? t('call.nodata') : 'Няма налични контакти';
        ul.appendChild(li);
        return;
      }
      for (const c of contacts) {
        const li = document.createElement('li');
        let text = c.name || '';
        if (c.role) text += ` (${c.role})`;
        if (c.phone) {
          li.innerHTML = `${text}: <a href="tel:${c.phone}">${c.phone}</a>`;
        } else {
          li.textContent = text;
        }
        ul.appendChild(li);
      }
    });
  }
  if (urlParam) {
    elUrl.value = urlParam;
    if (tParam) {
      const seekTo = Number(tParam);
      video.addEventListener('loadedmetadata', () => { video.currentTime = seekTo; }, { once: true });
    }
    startMonitoring();
  }
})();
