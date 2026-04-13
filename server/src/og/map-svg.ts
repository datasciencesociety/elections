import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Render Bulgaria (or a single municipality) as proportional colored tiles —
 * same algorithm as the frontend's district-pie-map.
 *
 * When `zoomMuniId` is set, renders ONLY that municipality zoomed to fill
 * the viewport. Otherwise renders all of Bulgaria.
 */

const SVG_W = 560;
const SVG_H = 320;

// Bulgaria bounding box (used when no zoom)
const BG_MIN_LNG = 22.3;
const BG_MAX_LNG = 28.7;
const BG_MIN_LAT = 41.2;
const BG_MAX_LAT = 44.25;

const NON_VOTER_COLOR = "#d4d4d4";
const OTHER_COLOR = "#999999";
const MIN_SHARE = 0.02;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(x: number, y: number, coords: number[][][]): boolean {
  if (!pointInRing(x, y, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(x, y, coords[i])) return false;
  }
  return true;
}

interface Viewport {
  minLng: number; maxLng: number;
  minLat: number; maxLat: number;
}

function makeProjectors(vp: Viewport) {
  const lngRange = vp.maxLng - vp.minLng;
  const latRange = vp.maxLat - vp.minLat;
  return {
    x: (lng: number) => ((lng - vp.minLng) / lngRange) * SVG_W,
    y: (lat: number) => SVG_H - ((lat - vp.minLat) / latRange) * SVG_H,
  };
}

export interface MapSvgResult {
  svg: string;
  /** Party colors actually rendered on the map (excludes non-voter gray and "other" bucket). */
  usedPartyColors: Set<string>;
}

export function renderMapSvg(
  db: DatabaseType,
  electionId: number,
  zoomMuniId?: number | null,
  highlightPartyColor?: string | null,
): MapSvgResult {
  // Determine which municipalities to render
  const whereClause = zoomMuniId ? "AND m.id = ?" : "";
  const params: unknown[] = [electionId];
  if (zoomMuniId) params.push(zoomMuniId);

  const muniRows = db
    .prepare(
      `SELECT m.id, m.geo,
              COALESCE(SUM(p.registered_voters), 0) AS registered_voters,
              COALESCE(SUM(p.actual_voters), 0) AS actual_voters
         FROM municipalities m
         JOIN locations l ON l.municipality_id = m.id
         JOIN sections s ON s.location_id = l.id AND s.election_id = ?
         LEFT JOIN protocols p ON p.election_id = s.election_id AND p.section_code = s.section_code
        WHERE m.geo IS NOT NULL ${whereClause}
        GROUP BY m.id`,
    )
    .all(...params) as {
    id: number; geo: string; registered_voters: number; actual_voters: number;
  }[];

  // Party votes
  const partyParams: unknown[] = [electionId];
  const partyWhere = zoomMuniId ? "AND l.municipality_id = ?" : "";
  if (zoomMuniId) partyParams.push(zoomMuniId);

  const partyRows = db
    .prepare(
      `SELECT l.municipality_id AS muni_id,
              COALESCE(pa.color, '#888888') AS color,
              SUM(v.total) AS votes
         FROM votes v
         JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
         JOIN locations l ON l.id = s.location_id
         JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
         JOIN parties pa ON pa.id = ep.party_id
        WHERE v.election_id = ? ${partyWhere}
        GROUP BY l.municipality_id, ep.party_id
        ORDER BY l.municipality_id, votes DESC`,
    )
    .all(...partyParams) as { muni_id: number; color: string; votes: number }[];

  const partyMap = new Map<number, { color: string; votes: number }[]>();
  for (const r of partyRows) {
    if (!partyMap.has(r.muni_id)) partyMap.set(r.muni_id, []);
    partyMap.get(r.muni_id)!.push({ color: r.color, votes: r.votes });
  }

  // Compute viewport
  let vp: Viewport;
  if (zoomMuniId && muniRows.length > 0) {
    // Zoom to municipality bbox with padding
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const muni of muniRows) {
      const geo = JSON.parse(muni.geo) as { type: string; coordinates: number[][][] | number[][][][] };
      const rings = geo.type === "Polygon"
        ? [geo.coordinates as number[][][]]
        : (geo.coordinates as number[][][][]);
      for (const poly of rings) {
        for (const pt of poly[0]) {
          if (pt[0] < minLng) minLng = pt[0];
          if (pt[1] < minLat) minLat = pt[1];
          if (pt[0] > maxLng) maxLng = pt[0];
          if (pt[1] > maxLat) maxLat = pt[1];
        }
      }
    }
    // Add 15% padding
    const padLng = (maxLng - minLng) * 0.15;
    const padLat = (maxLat - minLat) * 0.15;
    vp = {
      minLng: minLng - padLng, maxLng: maxLng + padLng,
      minLat: minLat - padLat, maxLat: maxLat + padLat,
    };
  } else {
    vp = { minLng: BG_MIN_LNG, maxLng: BG_MAX_LNG, minLat: BG_MIN_LAT, maxLat: BG_MAX_LAT };
  }

  const proj = makeProjectors(vp);

  // Grid step — finer for zoomed single municipality
  const lngSpan = vp.maxLng - vp.minLng;
  const gridStep = zoomMuniId ? lngSpan / 80 : 0.045;
  const half = gridStep / 2;

  const pxStep = proj.x(vp.minLng + gridStep) - proj.x(vp.minLng);
  const tileSize = Math.max(1, pxStep - 0.3);

  const rects: string[] = [];
  const usedPartyColors = new Set<string>();

  for (const muni of muniRows) {
    const geo = JSON.parse(muni.geo) as
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] };

    const allRings: number[][][][] =
      geo.type === "Polygon" ? [geo.coordinates] : geo.coordinates;

    // Bounding box
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const poly of allRings) {
      for (const pt of poly[0]) {
        if (pt[0] < bMinX) bMinX = pt[0];
        if (pt[1] < bMinY) bMinY = pt[1];
        if (pt[0] > bMaxX) bMaxX = pt[0];
        if (pt[1] > bMaxY) bMaxY = pt[1];
      }
    }

    // Grid cells
    const cells: [number, number][] = [];
    for (let x = bMinX + half; x < bMaxX; x += gridStep) {
      for (let y = bMinY + half; y < bMaxY; y += gridStep) {
        for (const poly of allRings) {
          if (pointInPolygon(x, y, poly)) {
            cells.push([x, y]);
            break;
          }
        }
      }
    }
    if (cells.length === 0) continue;

    // Proportional colors
    const parties = partyMap.get(muni.id) ?? [];
    const total = muni.registered_voters || 1;

    type Slice = { color: string; share: number };
    const slices: Slice[] = [];
    let otherShare = 0;

    for (const p of parties) {
      const share = p.votes / total;
      if (share >= MIN_SHARE) {
        slices.push({ color: p.color, share });
        usedPartyColors.add(p.color.toLowerCase());
      } else {
        otherShare += share;
      }
    }
    if (otherShare > 0) slices.push({ color: OTHER_COLOR, share: otherShare });

    const nv = muni.registered_voters - muni.actual_voters;
    if (nv > 0) slices.push({ color: NON_VOTER_COLOR, share: nv / total });

    slices.sort((a, b) => b.share - a.share);

    const colorAssignments: string[] = [];
    let remaining = cells.length;
    for (let i = 0; i < slices.length; i++) {
      const isLast = i === slices.length - 1;
      const count = isLast ? remaining : Math.round(slices[i].share * cells.length);
      const actual = Math.min(count, remaining);
      for (let j = 0; j < actual; j++) colorAssignments.push(slices[i].color);
      remaining -= actual;
    }

    const rng = seededRandom(muni.id * 7919);
    for (let i = colorAssignments.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [colorAssignments[i], colorAssignments[j]] = [colorAssignments[j], colorAssignments[i]];
    }

    for (let i = 0; i < cells.length && i < colorAssignments.length; i++) {
      const px = proj.x(cells[i][0]) - tileSize / 2;
      const py = proj.y(cells[i][1]) - tileSize / 2;
      let fill = colorAssignments[i];
      // Dim tiles that don't match the highlighted party
      if (highlightPartyColor && fill.toLowerCase() !== highlightPartyColor.toLowerCase()) {
        fill = blendToGray(fill, 0.75);
      }
      rects.push(
        `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${tileSize.toFixed(1)}" height="${tileSize.toFixed(1)}" fill="${fill}" rx="0.5"/>`,
      );
    }
  }

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}"><rect width="${SVG_W}" height="${SVG_H}" fill="#fbfbfb"/>${rects.join("")}</svg>`,
    usedPartyColors,
  };
}

function blendToGray(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = 220;
  const mix = (c: number) => Math.round(c + (gray - c) * t);
  return `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`;
}
