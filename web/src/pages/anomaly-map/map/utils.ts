import type MapLibreGL from "maplibre-gl";
import type { AnomalySection, AnomalyMethodology } from "@/lib/api/types.js";
import {
  GOLDEN_ANGLE,
  OFFSET_RADIUS,
  WARNING_ICON,
  WARNING_ICON_SIZE,
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
 * - `ensureWarningIcon`: lazily registers the white rounded-square SDF
 *   icon the anomaly markers are coloured with.
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

function getRiskValue(
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
  colorByCode: Map<string, string>,
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
        winner_color: colorByCode.get(s.section_code) ?? "#888",
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

export function ensureWarningIcon(map: MapLibreGL.Map) {
  if (map.hasImage(WARNING_ICON)) return;
  const size = WARNING_ICON_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Rounded square. Fill the full canvas so the symbol-layer icon-size
  // math stays predictable — consumers want "icon-size × canvas = pixels".
  const radius = size / 5;
  const x = 0;
  const y = 0;
  const w = size;
  const h = size;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
  const imageData = ctx.getImageData(0, 0, size, size);
  map.addImage(WARNING_ICON, imageData, { sdf: true });
}
