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
 * Options:
 *   --concurrency=N  parallel OIK pages (default: 3)
 *   --tour=N         only include streams for tour N (default: all tours)
 *   --type=d|r       d=device recordings (default), r=live recordings, both=d,r
 *
 * JSON written to stdout; progress goes to stderr.
 */

const { chromium } = require('@playwright/test');

const indexUrl    = process.argv.find(a => a.startsWith('http'));
const concurrency = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '3', 10);
const tourFilter  = process.argv.find(a => a.startsWith('--tour='))?.split('=')[1] ?? null;
const typeArg     = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] ?? 'd';

if (!indexUrl) {
  process.stderr.write(
    'Usage: node scrape-streams.js <index-url> [--concurrency=N] [--tour=N] [--type=d|r|both]\n'
  );
  process.exit(1);
}

function log(msg) { process.stderr.write(msg + '\n'); }

// ── Browser context factory (anti-Cloudflare fingerprint) ─────────────────────

async function makePage(browser) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
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
    await page.goto(oikUrl, { waitUntil: 'networkidle', timeout: 45_000 });
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

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  log(`Launching browser…`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    // Step 1: collect OIK sub-page URLs from the index
    log(`Fetching index: ${indexUrl}`);
    const indexPage = await makePage(browser);
    let oikPages;
    try {
      await indexPage.goto(indexUrl, { waitUntil: 'networkidle', timeout: 45_000 });
      oikPages = await indexPage.evaluate(() =>
        Array.from(document.querySelectorAll('a.oik')).map(a => ({
          url:   a.href,
          label: a.textContent.trim().replace(/\s+/g, ' ').replace(/(\d)([^\d\s])/g, '$1 $2'),
        }))
      );
      // Deduplicate by URL
      const seen = new Set();
      oikPages = oikPages.filter(p => { if (seen.has(p.url)) return false; seen.add(p.url); return true; });
    } finally {
      await indexPage.close();
    }

    log(`Found ${oikPages.length} OIK page(s): ${oikPages.map(p => p.label).join(', ')}`);

    if (oikPages.length === 0) {
      log('No OIK pages found on the index. Check the URL.');
      process.exit(1);
    }

    // Step 2: scrape each OIK page in parallel
    log(`Scraping with concurrency=${concurrency}, tour=${tourFilter ?? 'all'}, type=${typeArg}…`);

    const streams = await runPool(oikPages, async ({ url, label }, i) => {
      const page = await makePage(browser);
      try {
        log(`[${i+1}/${oikPages.length}] ${label} — ${url}`);
        const found = await scrapeOik(page, url, label);
        log(`[${i+1}/${oikPages.length}] → ${found.length} stream(s)`);
        return found;
      } finally {
        await page.close();
      }
    }, concurrency);

    // Deduplicate by URL
    const seen = new Set();
    const unique = streams.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    log(`\nTotal unique streams: ${unique.length}`);
    process.stdout.write(JSON.stringify(unique, null, 2) + '\n');

  } finally {
    await browser.close();
  }
})().catch(e => {
  process.stderr.write(`Fatal: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
