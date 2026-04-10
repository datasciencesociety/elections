#!/usr/bin/env python3
"""
scrape_mi2023_reference.py — How the mi2023 entries in cik_reference.json
were collected.

results.cik.bg sits behind Cloudflare, so a plain `requests`/`urllib` fetch
returns 403. The scrape is therefore driven from inside a real browser
session via the JavaScript snippet below.

Why no Python implementation? Cloudflare bot challenges + Bulgarian Cyrillic
encoding + a 530-page sequential walk made a curl/requests path infeasible
for a one-off. The JS snippet runs in seconds inside an authenticated tab
because it uses same-origin `fetch()`.

To reproduce:
  1. Open https://results.cik.bg/mi2023/tur1/rezultati/0101.html in Chrome
  2. Solve the Cloudflare challenge once (it sets a cookie for the session)
  3. Open the DevTools console
  4. Paste the snippet from data/_mi2023_scraper.js (see below) and run
  5. The snippet aggregates per-ballot totals across all 265 municipalities
     for both rounds and dumps the result as JSON to the console
  6. Copy the JSON, save to /tmp/mi2023_ref.json, then run:

         python3 -c "
         import json
         ref = json.load(open('data/cik_reference.json'))
         mi  = json.load(open('/tmp/mi2023_ref.json'))
         ref.update(mi)
         json.dump(ref, open('data/cik_reference.json','w'),
                   ensure_ascii=False, indent=2)
         "

Aggregation details:
  - Per-municipality pages contain 4 table sections (mayor, council,
    kmetstvo×N, neighbourhood×N).
  - The "name" column for kmetstvo/neighbourhood concatenates the candidate
    name and the party name (innerText collapses the original <br>); the
    snippet stores whatever the first encountered row had so the resulting
    name field is illustrative, not normalized. The vote totals are what
    matter for the cik_reference comparison.
  - Council preference-distribution sub-rows have an empty col[0] and are
    skipped — only the party rows count.
  - "Не подкрепям никого" (col[0] == "-") is a null-vote row, also skipped.

Schema written to cik_reference.json (per mi2023_* slug):
  {
    "name": "<human label>",
    "party_votes_total": <int>,           # sum of all named party votes
    "parties": {                          # keyed by ballot number (string)
      "<n>": { "name": "<string>", "votes": <int> },
      ...
    }
  }

No `protocol` block — protocol totals (registered, actual, invalid, null)
aren't aggregated on the per-municipality rezultati page; they live inside
each section's protocol viewer iframe and would require scraping a separate
page per polling station. The cik-reference.test.ts skips the protocol
checks for entries that don't carry a `protocol` block, so this is fine.

The full JavaScript snippet is preserved below for posterity. Update it if
the CIK page structure changes between elections.
"""

# fmt: off
JAVASCRIPT_SNIPPET = r"""
// Paste this in the DevTools console of any results.cik.bg/mi2023 page.

(async () => {
  // 1. Set up state
  const munis = await fetch('https://elections.example/mi2023_munis.txt')
    .then(r => r.text())
    .then(t => t.trim().split('\n'))
    .catch(() => null);
  if (!munis) {
    // Fallback: paste your municipality list here
    throw new Error('Provide the municipality codes via the fetch above or hardcode them.');
  }

  const agg = {
    tur1: { mayor: {}, council: {}, kmetstvo: {}, neighbourhood: {} },
    tur2: { mayor: {}, council: {}, kmetstvo: {}, neighbourhood: {} },
  };

  function parsePage(doc) {
    const result = { mayor: null, council: null, kmetstva: [], neighbourhoods: [] };
    for (const h of doc.querySelectorAll('h2, h3')) {
      const title = h.innerText.trim();
      let kind = null;
      if (/избор на кмет на община/i.test(title)) kind = 'mayor';
      else if (/избор на общински съвет/i.test(title)) kind = 'council';
      else if (/избор на кмет на кметство/i.test(title)) kind = 'kmetstvo';
      else if (/избор на кмет на район/i.test(title)) kind = 'neighbourhood';
      if (!kind) continue;

      let el = h.nextElementSibling;
      while (el && el.tagName !== 'TABLE') el = el.nextElementSibling;
      if (!el) continue;

      const ballots = [];
      for (const row of el.rows) {
        const cells = Array.from(row.cells).map(c => c.innerText.trim());
        if (cells.length < 3) continue;
        const n = cells[0];
        if (n === '№' || n === '' || n === '-') continue;
        const ballot = parseInt(n);
        if (isNaN(ballot)) continue;
        const lines = cells[1].split('\n').map(s => s.trim()).filter(Boolean);
        let name = (lines[lines.length - 1] || '').replace(/\s*разпределение на предпочитанията\s*$/i, '').trim();
        const votes = parseInt(cells[2].replace(/\s+/g, ''));
        if (isNaN(votes)) continue;
        ballots.push({ n: ballot, name, votes });
      }

      if (kind === 'mayor') result.mayor = { ballots };
      else if (kind === 'council') result.council = { ballots };
      else if (kind === 'kmetstvo') result.kmetstva.push({ ballots });
      else if (kind === 'neighbourhood') result.neighbourhoods.push({ ballots });
    }
    return result;
  }

  function aggregate(tur, parsed) {
    const target = agg[tur];
    function add(kind, ballots) {
      for (const b of ballots) {
        const slot = target[kind][b.n] || (target[kind][b.n] = { name: b.name, votes: 0 });
        if (!slot.name && b.name) slot.name = b.name;
        slot.votes += b.votes;
      }
    }
    if (parsed.mayor) add('mayor', parsed.mayor.ballots);
    if (parsed.council) add('council', parsed.council.ballots);
    for (const k of parsed.kmetstva) add('kmetstvo', k.ballots);
    for (const k of parsed.neighbourhoods) add('neighbourhood', k.ballots);
  }

  // 2. Walk both rounds
  for (const tur of ['tur1', 'tur2']) {
    for (const m of munis) {
      const r = await fetch(`/mi2023/${tur}/rezultati/${m}.html`);
      if (!r.ok) { console.warn(`${tur}/${m} ${r.status}`); continue; }
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      aggregate(tur, parsePage(doc));
    }
  }

  // 3. Build cik_reference shape
  const SLUGS = {
    'mi2023_council':          ['Общ.съветници 29.10.2023',         'tur1', 'council'],
    'mi2023_mayor_r1':         ['Кмет 29.10.2023',                  'tur1', 'mayor'],
    'mi2023_kmetstvo_r1':      ['Кмет кметство 29.10.2023',         'tur1', 'kmetstvo'],
    'mi2023_neighbourhood_r1': ['Кмет район 29.10.2023',            'tur1', 'neighbourhood'],
    'mi2023_mayor_r2':         ['Кмет 05.11.2023',                  'tur2', 'mayor'],
    'mi2023_kmetstvo_r2':      ['Кмет кметство 05.11.2023',         'tur2', 'kmetstvo'],
    'mi2023_neighbourhood_r2': ['Кмет район 05.11.2023',            'tur2', 'neighbourhood'],
  };
  const out = {};
  for (const [slug, [name, tur, kind]] of Object.entries(SLUGS)) {
    const m = agg[tur][kind];
    const ballots = Object.keys(m).map(Number).sort((a, b) => a - b);
    const parties = {};
    let total = 0;
    for (const b of ballots) {
      parties[String(b)] = { name: m[String(b)].name, votes: m[String(b)].votes };
      total += m[String(b)].votes;
    }
    out[slug] = { name, party_votes_total: total, parties };
  }
  console.log(JSON.stringify(out));
})();
"""
# fmt: on

if __name__ == "__main__":
    print(__doc__)
