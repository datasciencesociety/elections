/**
 * Static per-address index of Bulgarian polling locations for the 2026-04
 * parliamentary election — flattened from the official CIK polling-place
 * list (see `scripts/build-live-sections.py`).
 *
 * One entry per physical address. A "section" (секция) is a specific room
 * inside that address; a school hosting 10 sections is still one pin on
 * the map. The UI only renders markers by address to keep MapLibre from
 * stacking identical icons at the same coordinate.
 *
 * Served as a static file from Vite's `public/` root so it's a single HTTP
 * hit on page mount, gzipped by the CDN, and cached by the browser
 * indefinitely. ~1.3 MB uncompressed.
 */

export interface LiveAddress {
  /** Stable identifier — the first section code at this address. */
  id: string;
  rik: number;
  address: string;
  lat: number;
  lon: number;
  /** All section codes housed at this address, sorted. */
  section_codes: string[];
}

const URL_PATH = "/data/sections-pe202604.json";

export async function getLiveAddresses(): Promise<LiveAddress[]> {
  const res = await fetch(URL_PATH);
  if (!res.ok) throw new Error(`addresses static HTTP ${res.status}`);
  return (await res.json()) as LiveAddress[];
}
