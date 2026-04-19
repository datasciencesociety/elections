import type { LiveSection } from "@/lib/api/live-sections.js";

/**
 * "What else is happening near me" — for the nearby-chips row in each
 * video card. Two tiers:
 *   1. Sections that share the exact CIK address with the target. Same
 *      physical building — a school with 10 rooms usually hosts 10
 *      sections. Observers almost always want to watch these together.
 *   2. Nearest other sections within a short radius (default ~1.2 km
 *      straight-line at Bulgarian latitudes). Different buildings in the
 *      same neighborhood, capped so the chip row doesn't overflow.
 *
 * Distance is computed with a cheap equirectangular approximation. Good
 * enough for sub-10 km queries inside Bulgaria — a full haversine here
 * would be ceremony for no accuracy gain.
 */

/** Max neighbours in the radius tier. Keeps the chip row scannable. */
export const NEARBY_MAX = 4;
/** Radius in degrees (~1.2 km at BG latitudes). */
const NEARBY_RADIUS_DEG = 0.012;

const COS_BG = Math.cos((42.7 * Math.PI) / 180);

function approxDistanceDeg(a: LiveSection, b: LiveSection): number {
  const dx = (a.lon - b.lon) * COS_BG;
  const dy = a.lat - b.lat;
  return Math.hypot(dx, dy);
}

export interface NearbyGroups {
  sameAddress: LiveSection[];
  nearby: LiveSection[];
}

export function findNearby(
  target: LiveSection,
  sections: LiveSection[],
): NearbyGroups {
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) {
    return { sameAddress: [], nearby: [] };
  }

  const sameAddress: LiveSection[] = [];
  const candidates: { s: LiveSection; d: number }[] = [];

  for (const s of sections) {
    if (s.section_code === target.section_code) continue;
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;

    // "Same address" is literally the identical coordinate. The CIK index
    // gives every section at an address the same lat/lon, so this is an
    // exact equality check, not a distance check.
    if (s.lat === target.lat && s.lon === target.lon) {
      sameAddress.push(s);
      continue;
    }

    const d = approxDistanceDeg(target, s);
    if (d <= NEARBY_RADIUS_DEG) candidates.push({ s, d });
  }

  sameAddress.sort((a, b) => a.section_code.localeCompare(b.section_code));
  candidates.sort((a, b) => a.d - b.d);

  return {
    sameAddress,
    nearby: candidates.slice(0, NEARBY_MAX).map((c) => c.s),
  };
}
