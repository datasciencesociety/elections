import type { LiveAddress } from "@/lib/api/live-sections.js";

/**
 * Nearest other polling addresses for the "наблизо" chip row. Uses an
 * equirectangular approximation — fine for sub-10 km distances at
 * Bulgarian latitudes and avoids a full haversine per card open.
 *
 * "Same address" is no longer a tier: each card already represents an
 * entire polling address, and multi-section locations are handled inside
 * the card with a section picker. We just need other *addresses* nearby.
 */

export const NEARBY_MAX = 4;
const NEARBY_RADIUS_DEG = 0.012; // ~1.2 km at BG latitudes

const COS_BG = Math.cos((42.7 * Math.PI) / 180);

function approxDistanceDeg(a: LiveAddress, b: LiveAddress): number {
  const dx = (a.lon - b.lon) * COS_BG;
  const dy = a.lat - b.lat;
  return Math.hypot(dx, dy);
}

export function findNearbyAddresses(
  target: LiveAddress,
  all: LiveAddress[],
): LiveAddress[] {
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return [];

  const candidates: { a: LiveAddress; d: number }[] = [];
  for (const a of all) {
    if (a.id === target.id) continue;
    if (a.lat === target.lat && a.lon === target.lon) continue;
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
    const d = approxDistanceDeg(target, a);
    if (d <= NEARBY_RADIUS_DEG) candidates.push({ a, d });
  }

  candidates.sort((x, y) => x.d - y.d);
  return candidates.slice(0, NEARBY_MAX).map((c) => c.a);
}
