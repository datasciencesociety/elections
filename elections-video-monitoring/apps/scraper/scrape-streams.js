#!/usr/bin/env node
'use strict';

/**
 * scrape-streams.js
 *
 * Scrapes an evideo.bg election index page and extracts all stream URLs + labels,
 * outputting a JSON array suitable for POST /api/streams.
 *
 * Uses Playwright (already a dev dependency) to handle Cloudflare JS challenges.
 *
 * Usage:
 *   node scrape-streams.js https://evideo.bg/le20260222/index.html
 *   node scrape-streams.js https://evideo.bg/le20260222/index.html > streams.json
 *   node scrape-streams.js https://evideo.bg/le20260222/index.html --concurrency=4
 *   node scrape-streams.js https://evideo.bg/le20260222/index.html --tour=1
 *
 *   # Election day: wait for the new election on evideo.bg, then seed the coordinator
 *   # page by page and rescrape every 2 min (needs SEED_USER/SEED_PASS, COORDINATOR_URL)
 *   node scrape-streams.js --discover --upsert --watch=120
 *
 * Options:
 *   --concurrency=N  parallel OIK pages (default: 3)
 *   --tour=N         only include streams for tour N (default: all tours)
 *   --type=d|r       d=device recordings (default), r=live recordings, both=d,r
 *   --discover[=URL] poll the evideo home page (default https://evideo.bg/) until an election
 *                    code appears that was not linked at start, then scrape its index
 *   --code=X         with --discover: wait for this code (e.g. pvr202610) instead of any new one
 *   --poll=S         --discover poll interval in seconds (default 300; keep it slow for Cloudflare)
 *   --upsert         send each OIK page's streams to the coordinator as soon as it is parsed
 *   --watch=S        rescrape every S seconds; with --upsert only new/changed sections are sent
 *   --fast           block video requests and stop waiting once sections are in the DOM
 *   --profile=DIR    browser profile kept between runs (default ~/.cache/evideo-scraper);
 *                    holds the Cloudflare clearance cookie and the --upsert progress
 *   --headed         show the browser window (if Cloudflare keeps challenging headless)
 *
 * Cloudflare: the scraper acts as one polite visitor. One persistent Chrome profile for all
 * pages, page loads spaced >=1.5 s apart, and on a challenge that does not clear by itself,
 * every request pauses with backoff (1, 2, 4 … 15 min). It never tries to defeat the challenge.
 *
 * JSON written to stdout (single run without --watch); progress goes to stderr.
 */

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const opt = (name) => process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const optVal = (name, dflt) => { const a = opt(name); return a && a.includes('=') ? a.slice(a.indexOf('=') + 1) : dflt; };

const indexArg    = process.argv.find(a => a.startsWith('http'));
const concurrency = parseInt(optVal('concurrency', '3'), 10);
const tourFilter  = optVal('tour', null);
const typeArg     = optVal('type', 'd');
const discoverUrl = opt('discover') ? optVal('discover', 'https://evideo.bg/') : null;
const wantCode    = optVal('code', null);
const pollSec     = parseInt(optVal('poll', '300'), 10);
const doUpsert    = !!opt('upsert');
const watchSec    = opt('watch') ? parseInt(optVal('watch', '120'), 10) : 0;
const fast        = !!opt('fast');
const headed      = !!opt('headed');
const profileDir  = optVal('profile', path.join(os.homedir(), '.cache', 'evideo-scraper'));

if (!indexArg && !discoverUrl) {
  process.stderr.write(
    'Usage: node scrape-streams.js <index-url> | --discover[=URL] [--code=X] [--upsert] [--watch=S] [--fast]\n' +
    '       [--concurrency=N] [--tour=N] [--type=d|r|both]\n'
  );
  process.exit(1);
}

function log(msg) { process.stderr.write(msg + '\n'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let warnedTourIgnored = false;

// ── Browser: one persistent profile, so all pages share the Cloudflare cookie ──

async function openBrowser() {
  fs.mkdirSync(profileDir, { recursive: true });
  const launch = (channel) => chromium.launchPersistentContext(profileDir, {
    channel,
    headless: !headed,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  // Installed Google Chrome; its own user agent matches its engine
  try { return await launch('chrome'); }
  catch { log('Google Chrome not found; using bundled Chromium'); return launch(undefined); }
}

async function makePage(ctx) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
}

// ── Polite navigation: paced, and paused for everyone on a Cloudflare challenge ──

const MIN_GAP_MS = 1500;
let nextNavAt = 0;
let backoffMs = 0;

const isChallenge = async (page) => /just a moment|attention required/i.test(await page.title().catch(() => ''));

async function politeGoto(page, url, waitUntil) {
  const now = Date.now();
  const start = Math.max(now, nextNavAt);
  nextNavAt = start + MIN_GAP_MS + Math.random() * 1000;
  if (start > now) await sleep(start - now);

  const res = await page.goto(url, { waitUntil, timeout: 45_000 });
  if (await isChallenge(page)) {
    // A real browser usually clears the JS challenge within a few seconds
    await page.waitForFunction(() => !/just a moment|attention required/i.test(document.title), null, { timeout: 30_000 }).catch(() => {});
    if (await isChallenge(page)) {
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 60_000, 15 * 60_000);
      nextNavAt = Date.now() + backoffMs;
      throw new Error(`Cloudflare challenge on ${url}; pausing all requests for ${backoffMs / 1000}s`);
    }
    if (waitUntil === 'networkidle') await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  }
  backoffMs = 0;
  return res;
}

// ── URL construction ──────────────────────────────────────────────────────────

/**
 * Expand a data-vid reference like "r0#/filename.mp4" into a full URL.
 * The server inserts the station ID as a subdirectory: .../real/{sik}/filename.mp4
 * sik is the data-sik value of the parent section div.
 * Fallback: extract station ID from filename (4th underscore-delimited segment).
 */
function expandRef(ref, servers, sik) {
  const sep = ref.indexOf('#');
  if (sep < 0) return null;
  const key      = ref.slice(0, sep);
  const filename = ref.slice(sep + 1).replace(/^\/+/, '');
  const base     = servers[key];
  if (!base) return null;

  // Station ID directory: prefer data-sik, fall back to parsing the filename
  const stationId = sik || filename.split('_')[3] || null;
  const dir = stationId ? stationId + '/' : '';
  return base.replace(/\/$/, '') + '/' + dir + filename;
}

// ── Parse one OIK page ────────────────────────────────────────────────────────

async function scrapeOik(page, oikUrl, oikLabel) {
  let rawHtml = '';
  const onResponse = async (response) => {
    // Match loosely: URL may gain query params (CF challenge token)
    if (response.url().split('?')[0] === oikUrl.split('?')[0] && response.status() === 200) {
      try { rawHtml = await response.text(); } catch {}
    }
  };
  page.on('response', onResponse);

  try {
    if (fast) {
      // Live players on the page keep the network busy; don't wait for idle, wait for the sections
      await page.route('**/*', (route) => {
        const req = route.request();
        if (req.resourceType() === 'media' || /\.(m3u8|ts|m4s|mp4)(\?|$)/.test(req.url())) return route.abort();
        return route.continue();
      });
      await politeGoto(page, oikUrl, 'domcontentloaded');
      await page.waitForSelector('[data-sik]', { timeout: 45_000 }).catch(() => log(`  Warning: no sections rendered on ${oikUrl}`));
    } else {
      await politeGoto(page, oikUrl, 'networkidle');
    }
  } finally {
    page.off('response', onResponse);
  }

  if (!rawHtml) {
    log(`  Warning: could not capture raw HTML for ${oikUrl}`);
    rawHtml = await page.content();
  }

  // Extract servers map (old format only; new format embeds full URLs directly)
  let servers = {};
  const serversMatch = rawHtml.match(/var servers\s*=\s*(\{[^}]+\})/);
  if (serversMatch) {
    try { servers = JSON.parse(serversMatch[1]); } catch {}
  }

  // Extract each section
  const streams = [];

  // Match each <div class="section ..." data-sik="..."> block
  // Terminated by next section div, a closing </div> cluster before footer, or end of string
  const sectionRe = /<div[^>]*class="[^"]*\bsection\b[^"]*"[^>]*data-sik="(\d+)"[^>]*>([\s\S]+?)(?=<div[^>]*class="[^"]*\bsection\b|<\/div>\s*<\/div>\s*<\/div>\s*<footer|$)/gi;

  let m;
  while ((m = sectionRe.exec(rawHtml)) !== null) {
    const sik      = m[1];
    const inner    = m[2];

    // Location name
    const nameMatch = inner.match(/class="[^"]*section__name[^"]*"[^>]*>([^<]+)</);
    const location  = nameMatch ? nameMatch[1].trim() : '';
    const label     = `${oikLabel} / ${sik}${location ? ' ' + location : ''}`;

    // New format: data-vid='["https://..."]' — plain URL array, no data-tour
    const newBtnRe = /data-vid='([^']+)'/g;
    let bm;
    let pushed = false;
    while ((bm = newBtnRe.exec(inner)) !== null) {
      let vid;
      try { vid = JSON.parse(bm[1]); } catch { continue; }
      if (Array.isArray(vid) && vid.length > 0 && typeof vid[0] === 'string' && vid[0].startsWith('http')) {
        // tourFilter doesn't apply — no tour metadata in this format
        if (tourFilter && !warnedTourIgnored) {
          log(`  Warning: --tour=${tourFilter} ignored — this page format has no tour data; output may mix tours`);
          warnedTourIgnored = true;
        }
        streams.push({ section: sik, url: vid[0], label });
        pushed = true;
        break;
      }
    }
    if (pushed) continue;

    // Old format: data-tour="N" data-vid='{"d":[...],"r":[...]}' with servers map
    const oldBtnRe = /data-tour="(\d+)"[^>]*data-vid='([^']+)'/g;
    while ((bm = oldBtnRe.exec(inner)) !== null) {
      const tour   = bm[1];
      if (tourFilter && tour !== tourFilter) continue;

      let vid;
      try { vid = JSON.parse(bm[2]); } catch { continue; }

      // Pick stream type: 'd' = device recording, 'r' = live recording
      const types = typeArg === 'both' ? ['d', 'r'] : [typeArg];
      for (const type of types) {
        const refs = vid[type];
        if (!Array.isArray(refs) || refs.length === 0) continue;
        // Use the first (primary) ref for each type
        const url = expandRef(refs[0], servers, sik);
        if (!url) continue;
        const tourLabel = `${label} (tour ${tour}${types.length > 1 ? ` ${type}` : ''})`;
        streams.push({ section: sik, url, label: tourLabel });
      }
    }
  }

  return streams;
}

// ── Worker pool ───────────────────────────────────────────────────────────────

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await worker(items[i], i); }
      catch (e) { results[i] = []; log(`Error: ${items[i]?.url ?? items[i]}: ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results.flat();
}

// ── Discover the election index on the evideo home page ───────────────────────

const CODE_RE = /(?:^|\/)([a-z]+\d{4,8})\/index\.html$/;

async function listCodes(page, homeUrl) {
  await politeGoto(page, homeUrl, 'domcontentloaded');
  await page.waitForSelector('a[href*="index.html"]', { timeout: 45_000 }).catch(() => {});
  const codes = new Map();
  for (const href of await page.$$eval('a[href]', as => as.map(a => a.href))) {
    const m = new URL(href).pathname.match(CODE_RE);
    if (m) codes.set(m[1], href);
  }
  return codes;
}

// Returns the index URL of --code, or of the first code that was not linked at start
async function discoverIndex(ctx) {
  const page = await makePage(ctx);
  try {
    let baseline = null;
    for (;;) {
      const codes = await listCodes(page, discoverUrl).catch(e => { log(`Discover: ${e.message}`); return null; });
      if (codes) {
        if (!baseline) {
          baseline = new Set(codes.keys());
          log(`Discover: linked at start: ${[...baseline].join(', ') || '(none)'}${wantCode ? '' : ' (already-linked codes need --code)'}`);
        }
        const hit = wantCode ? (codes.has(wantCode) ? wantCode : null) : [...codes.keys()].find(c => !baseline.has(c));
        if (hit) { log(`Discover: found ${hit} → ${codes.get(hit)}`); return codes.get(hit); }
      }
      log(`Discover: waiting for ${wantCode || 'a new election code'}; next check in ~${pollSec}s`);
      await sleep(pollSec * 1000 * (0.9 + Math.random() * 0.2));
    }
  } finally {
    await page.close();
  }
}

// ── Scrape passes ─────────────────────────────────────────────────────────────

async function listOikPages(ctx, indexUrl) {
  log(`Fetching index: ${indexUrl}`);
  const indexPage = await makePage(ctx);
  try {
    await politeGoto(indexPage, indexUrl, 'networkidle');
    const oikPages = await indexPage.evaluate(() =>
      Array.from(document.querySelectorAll('a.oik')).map(a => ({
        url:   a.href,
        label: a.textContent.trim().replace(/\s+/g, ' ').replace(/(\d)([^\d\s])/g, '$1 $2'),
      }))
    );
    // Deduplicate by URL
    const seen = new Set();
    return oikPages.filter(p => { if (seen.has(p.url)) return false; seen.add(p.url); return true; });
  } finally {
    await indexPage.close();
  }
}

// onPage(streams) runs as soon as each OIK page is parsed
async function scrapePass(ctx, oikPages, onPage) {
  log(`Scraping with concurrency=${concurrency}, tour=${tourFilter ?? 'all'}, type=${typeArg}${fast ? ', fast' : ''}…`);
  const streams = await runPool(oikPages, async ({ url, label }, i) => {
    const page = await makePage(ctx);
    try {
      log(`[${i+1}/${oikPages.length}] ${label} — ${url}`);
      const found = await scrapeOik(page, url, label);
      log(`[${i+1}/${oikPages.length}] → ${found.length} stream(s)`);
      if (onPage && found.length) await onPage(found);
      return found;
    } finally {
      await page.close();
    }
  }, concurrency);

  // Deduplicate by URL
  const seen = new Set();
  return streams.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  log(`Launching browser (profile ${profileDir})…`);
  const ctx = await openBrowser();
  const client = doUpsert ? require('../../scripts/lib/coordinator').createClient() : null;
  if (client) log(`Upserting to ${client.base}`);

  try {
    const indexUrl = indexArg || await discoverIndex(ctx);
    // section → URL last sent to the coordinator; kept on disk so a restart doesn't resend everything
    const code = new URL(indexUrl).pathname.split('/')[1] || 'index';
    const stateFile = path.join(profileDir, `sent-${code}.json`);
    const sent = new Map(fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : []);
    if (client && sent.size) log(`Resuming: ${sent.size} sections already sent (${stateFile})`);

    for (let pass = 1; ; pass++) {
      let oikPages;
      try {
        oikPages = await listOikPages(ctx, indexUrl);
      } catch (e) {
        if (!watchSec) throw e;
        log(`Index failed (${e.message}); retry in ${watchSec}s`);
        await sleep(watchSec * 1000);
        continue;
      }
      log(`Found ${oikPages.length} OIK page(s): ${oikPages.map(p => p.label).join(', ')}`);
      if (oikPages.length === 0 && !watchSec) {
        log('No OIK pages found on the index. Check the URL.');
        process.exit(1);
      }

      let onPage = null;
      if (client) {
        const assigned = await client.assignments();
        onPage = async (found) => {
          const changed = found.filter(s => sent.get(s.section) !== s.url);
          if (changed.length === 0) return;
          // Send the stored assignments back: older coordinators clear assigned_users when a row omits it
          const rows = changed.map(s => ({ ...s, assigned_users: assigned.get(s.section) ?? null }));
          try {
            const r = await client.upsert(rows);
            changed.forEach(s => sent.set(s.section, s.url));
            fs.writeFileSync(stateFile, JSON.stringify([...sent]));
            log(`  upsert ${rows.length} → ${JSON.stringify(r)}`);
          } catch (e) {
            log(`  upsert failed (retried next pass): ${e.message}`);
          }
        };
      }

      const unique = await scrapePass(ctx, oikPages, onPage);
      log(`\nPass ${pass}: ${unique.length} unique streams${client ? `; ${sent.size} sections sent so far` : ''}`);

      if (!watchSec) {
        process.stdout.write(JSON.stringify(unique, null, 2) + '\n');
        break;
      }
      log(`Next pass in ${watchSec}s`);
      await sleep(watchSec * 1000);
    }
  } finally {
    await ctx.close();
  }
})().catch(e => {
  process.stderr.write(`Fatal: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
