import type MapLibreGL from "maplibre-gl";
import type { AnomalySection, AnomalyMethodology } from "@/lib/api/types.js";
import {
  GOLDEN_ANGLE,
  OFFSET_RADIUS,
  TRIANGLE_ICON,
  TRIANGLE_SIZE,
} from "./constants.js";

/**
 * Pure helpers shared by every layer in `anomaly-map/map/`.
 *
 * - `offsetOverlappingSections`: spreads stacked sections in a sunflower
 *   spiral around their original coordinate so a single dot doesn't hide
 *   ten neighbours.
 * - `getRiskValue`: maps a methodology choice to the score column on a
 *   section row. The "protocol" methodology is treated as binary: any
 *   violation count > 0 → 1, otherwise 0.
 * - `buildCircleFeatures`: turns a section list into a `FeatureCollection`
 *   ready to drop into a MapLibre source.
 * - `ensureTriangleIcon`: lazily registers the white triangle SDF icon used
 *   by the anomaly markers.
 */

export function offsetOverlappingSections<
  T extends { lat: number | null; lng: number | null },
>(sections: T[]): (T & { _lng: number; _lat: number })[] {
  const groups: Record<string, number[]> = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.lat == null || s.lng == null) continue;
    const key = `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  }

  const result: (T & { _lng: number; _lat: number })[] = [];
  for (const indices of Object.values(groups)) {
    if (indices.length === 1) {
      const s = sections[indices[0]];
      result.push({ ...s, _lng: s.lng!, _lat: s.lat! });
    } else {
      for (let j = 0; j < indices.length; j++) {
        const s = sections[indices[j]];
        const angle = j * GOLDEN_ANGLE;
        const r = OFFSET_RADIUS * Math.sqrt(j + 1);
        result.push({
          ...s,
          _lng: s.lng! + r * Math.cos(angle),
          _lat: s.lat! + r * Math.sin(angle),
        });
      }
    }
  }
  return result;
}

export function getRiskValue(
  s: AnomalySection,
  methodology: AnomalyMethodology,
): number {
  switch (methodology) {
    case "benford":
      return s.benford_risk ?? 0;
    case "peer":
      return s.peer_risk ?? 0;
    case "acf":
      return s.acf_risk ?? 0;
    case "protocol":
      return s.protocol_violation_count > 0 ? 1 : 0;
    default:
      return s.risk_score ?? 0;
  }
}

export function buildCircleFeatures(
  sections: AnomalySection[],
  methodology: AnomalyMethodology,
) {
  const spread = offsetOverlappingSections(
    sections.filter((s) => s.lat != null && s.lng != null),
  );
  return {
    type: "FeatureCollection" as const,
    features: spread.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s._lng, s._lat] },
      properties: {
        section_code: s.section_code,
        settlement_name: s.settlement_name,
        address: s.address ?? "",
        risk: getRiskValue(s, methodology),
        risk_score: s.risk_score ?? 0,
        benford_risk: s.benford_risk ?? 0,
        peer_risk: s.peer_risk ?? 0,
        acf_risk: s.acf_risk ?? 0,
        turnout_rate: s.turnout_rate ?? 0,
        turnout_zscore: s.turnout_zscore ?? 0,
        arithmetic_error: s.arithmetic_error ?? 0,
        vote_sum_mismatch: s.vote_sum_mismatch ?? 0,
      },
    })),
  };
}

export function ensureTriangleIcon(map: MapLibreGL.Map) {
  if (map.hasImage(TRIANGLE_ICON)) return;
  const size = TRIANGLE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Upward-pointing triangle (warning sign shape)
  const pad = 4;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(size / 2, pad);
  ctx.lineTo(size - pad, size - pad);
  ctx.lineTo(pad, size - pad);
  ctx.closePath();
  ctx.fill();
  const imageData = ctx.getImageData(0, 0, size, size);
  map.addImage(TRIANGLE_ICON, imageData, { sdf: true });
}
