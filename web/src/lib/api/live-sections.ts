/**
 * Static list of polling-section addresses for the 2026-04 parliamentary
 * election — flattened from the official CIK polling-place index. One row
 * per section code (see `scripts/build-live-sections.py`).
 *
 * Served as a static file from Vite's `public/` root so it's a single HTTP
 * hit on page mount, gzipped by the CDN, and cached by the browser
 * indefinitely. ~2 MB uncompressed.
 */

export interface LiveSection {
  section_code: string;
  rik: number;
  address: string;
  lat: number;
  lon: number;
}

const SECTIONS_URL = "/data/sections-pe202604.json";

export async function getLiveSections(): Promise<LiveSection[]> {
  const res = await fetch(SECTIONS_URL);
  if (!res.ok) throw new Error(`sections static HTTP ${res.status}`);
  return (await res.json()) as LiveSection[];
}
