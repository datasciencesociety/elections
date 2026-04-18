import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map as MapComponent, useMap, MapControls } from "@/components/ui/map";
import MapLibreGL from "maplibre-gl";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import {
  useAbroadByCountry,
  useGeoResults,
} from "@/lib/hooks/use-geo-results.js";
import type { GeoLevel } from "@/lib/api/geo-results.js";
import type { AbroadCountry, Election, GeoArea } from "@/lib/api/types.js";
import { AbroadMap } from "@/components/map/abroad-map.js";

// Local alias — district-pie-map narrows the geometry to polygon variants.
type GeoRegion = Omit<GeoArea, "geo"> & {
  geo: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};


interface AggregatedParty {
  name: string;
  color: string;
  totalVotes: number;
  /** Share of all registered voters (narrative denominator — includes
   *  non-voters and "не подкрепям никого"). Used to show "only X% of
   *  Bulgarians voted for this party." */
  pctRegistered: number;
  /** Share of party votes per CIK rules — excludes non-voters AND
   *  "не подкрепям никого". This is the percentage that determines the
   *  4% parliamentary threshold. null for the non-voter and null-vote
   *  rows which by definition aren't party votes. */
  pctCik: number | null;
}

const BULGARIA_CENTER: [number, number] = [25.3, 42.7];
const BULGARIA_ZOOM = 6.9;
const NON_VOTER_COLOR = "#c0c0c0";
const TILE_SOURCE = "region-tiles";
const TILE_LAYER = "region-tiles-fill";
const BORDER_SOURCE = "region-borders";
const BORDER_LAYER = "region-borders-line";
const OTHER_COLOR = "#999";
const MIN_SHARE = 0.02;

const BLANK_STYLE: MapLibreGL.StyleSpecification = {
  version: 8,
  name: "blank",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f8f8f8" },
    },
  ],
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function buildTileFeatures(
  region: GeoRegion,
  showNonVoters: boolean,
  gridStep: number,
): GeoJSON.Feature[] {
  const geo = region.geo;
  if (!geo) return [];

  const [minX, minY, maxX, maxY] = bbox({
    type: "Feature",
    geometry: geo,
    properties: {},
  });

  const half = gridStep / 2;
  const cells: [number, number][] = [];
  for (let x = minX + half; x < maxX; x += gridStep) {
    for (let y = minY + half; y < maxY; y += gridStep) {
      const pt = turfPoint([x, y]);
      if (booleanPointInPolygon(pt, geo)) {
        cells.push([x, y]);
      }
    }
  }

  if (cells.length === 0) return [];

  type Slice = { label: string; color: string; share: number };
  const slices: Slice[] = [];
  const total = showNonVoters ? region.registered_voters : region.total_votes;
  if (total <= 0) return [];

  let otherShare = 0;
  for (const p of region.parties) {
    const share = p.votes / total;
    if (share >= MIN_SHARE) {
      slices.push({ label: p.name, color: p.color, share });
    } else {
      otherShare += share;
    }
  }
  if (otherShare > 0) {
    slices.push({ label: "Други", color: OTHER_COLOR, share: otherShare });
  }
  if (showNonVoters) {
    const nv = region.registered_voters - region.actual_voters;
    if (nv > 0) {
      slices.push({ label: "Негласували", color: NON_VOTER_COLOR, share: nv / total });
    }
  }

  slices.sort((a, b) => b.share - a.share);

  const totalCells = cells.length;
  const colorAssignments: string[] = [];
  const labelAssignments: string[] = [];
  let remaining = totalCells;

  for (let i = 0; i < slices.length; i++) {
    const isLast = i === slices.length - 1;
    const count = isLast ? remaining : Math.round(slices[i].share * totalCells);
    const actual = Math.min(count, remaining);
    for (let j = 0; j < actual; j++) {
      colorAssignments.push(slices[i].color);
      labelAssignments.push(slices[i].label);
    }
    remaining -= actual;
  }

  const rng = seededRandom(region.id * 7919);
  for (let i = colorAssignments.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [colorAssignments[i], colorAssignments[j]] = [colorAssignments[j], colorAssignments[i]];
    [labelAssignments[i], labelAssignments[j]] = [labelAssignments[j], labelAssignments[i]];
  }

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < cells.length && i < colorAssignments.length; i++) {
    const [cx, cy] = cells[i];
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]],
      },
      properties: {
        region_id: region.id,
        region_name: region.name,
        color: colorAssignments[i],
        party_name: labelAssignments[i],
      },
    });
  }

  return features;
}

function getGridStep(level: GeoLevel): number {
  switch (level) {
    case "riks": return 0.025;
    case "districts": return 0.04;
    case "municipalities": return 0.02;
  }
}

/** Cheap polygon-size proxy via bbox area. Used to stack smaller regions
 *  on top of larger ones when their geometries overlap (e.g. Пловдив-град
 *  sits inside Пловдив-област; the oblast MIR's polygon includes the
 *  city area, so without z-ordering the city disappears). */
function bboxArea(r: GeoRegion): number {
  if (!r.geo) return 0;
  const [minX, minY, maxX, maxY] = bbox({ type: "Feature", geometry: r.geo, properties: {} });
  return (maxX - minX) * (maxY - minY);
}

function computeAllTiles(
  regions: GeoRegion[],
  showNonVoters: boolean,
  level: GeoLevel,
): GeoJSON.FeatureCollection {
  const step = getGridStep(level);
  // Largest bbox first → smallest renders last (on top).
  const ordered = [...regions].sort((a, b) => bboxArea(b) - bboxArea(a));
  const allFeatures: GeoJSON.Feature[] = [];
  for (const r of ordered) {
    allFeatures.push(...buildTileFeatures(r, showNonVoters, step));
  }
  return { type: "FeatureCollection", features: allFeatures };
}

/** A party row is "counted for CIK" if it's a real party. The synthetic
 *  "не подкрепям никого" row is given party_id -1 by the server; the
 *  "Негласували" aggregate has no party_id (it's not in `region.parties`
 *  at all — we append it manually). So a party is CIK-eligible iff
 *  party_id > 0. */
function isCikEligible(partyId: number): boolean {
  return partyId > 0;
}

function aggregateParties(
  regions: GeoRegion[],
  showNonVoters: boolean,
  abroadCountries: AbroadCountry[] = [],
): AggregatedParty[] {
  const byName = new Map<
    string,
    { color: string; votes: number; partyId: number }
  >();
  let registeredTotal = 0;
  let cikTotal = 0;

  const addParty = (p: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
  }) => {
    if (isCikEligible(p.party_id)) cikTotal += p.votes;
    const existing = byName.get(p.name);
    if (existing) {
      existing.votes += p.votes;
    } else {
      byName.set(p.name, {
        color: p.color || "#555",
        votes: p.votes,
        partyId: p.party_id,
      });
    }
  };

  for (const r of regions) {
    registeredTotal += r.registered_voters;
    for (const p of r.parties) addParty(p);
    if (showNonVoters) {
      const nv = r.registered_voters - r.actual_voters;
      if (nv > 0) {
        const existing = byName.get("Негласували");
        if (existing) {
          existing.votes += nv;
        } else {
          byName.set("Негласували", {
            color: NON_VOTER_COLOR,
            votes: nv,
            partyId: -2, // sentinel — not a party
          });
        }
      }
    }
  }

  // Abroad contributes to the national legend even though it renders
  // on the world-map inset, not on the Bulgaria map. Dropping it would
  // break the 4% CIK threshold because the denominator shrinks —
  // Velichie was visibly moving from 4.00 → 3.77 with abroad stripped.
  // Abroad has no "non-voter" pool: registered_voters == actual_voters
  // (pre-registration undercounts walk-ins, see server comment), so
  // there's no "Негласували" contribution.
  for (const ac of abroadCountries) {
    registeredTotal += ac.registered_voters;
    for (const p of ac.parties) addParty(p);
  }

  const result: AggregatedParty[] = [];
  for (const [name, { color, votes, partyId }] of byName) {
    result.push({
      name,
      color,
      totalVotes: votes,
      pctRegistered:
        registeredTotal > 0 ? (votes / registeredTotal) * 100 : 0,
      pctCik:
        isCikEligible(partyId) && cikTotal > 0
          ? (votes / cikTotal) * 100
          : null,
    });
  }
  result.sort((a, b) => b.totalVotes - a.totalVotes);
  return result;
}

// Map a per-country abroad aggregate onto the same AggregatedParty
// shape used by the Bulgarian legend. Abroad has no "not showed up"
// pool, so `registered` equals `actual` (see server: the protocol's
// pre-registration undercounts walk-in voters). That means the
// "Registered share" column collapses onto the CIK-rule share.
function aggregateAbroadCountryParties(country: AbroadCountry): AggregatedParty[] {
  const registeredTotal = country.registered_voters;
  const cikTotal = country.parties
    .filter((p) => p.party_id > 0)
    .reduce((sum, p) => sum + p.votes, 0);

  return country.parties.map((p) => ({
    name: p.name,
    color: p.color,
    totalVotes: p.votes,
    pctRegistered: registeredTotal > 0 ? (p.votes / registeredTotal) * 100 : 0,
    pctCik: p.party_id > 0 && cikTotal > 0 ? (p.votes / cikTotal) * 100 : null,
  }));
}

// Abroad-only national aggregate for the "Чужбина" tab default view.
// Sums every country into one party list. The Bulgaria tab uses
// aggregateParties(regions, …, abroadCountries) to merge abroad into
// the national CIK total; this one is the flip side — just abroad.
function aggregateAbroadNationalParties(
  abroadCountries: AbroadCountry[],
): AggregatedParty[] {
  const byName = new Map<
    string,
    { color: string; votes: number; partyId: number }
  >();
  let registeredTotal = 0;
  let cikTotal = 0;
  for (const ac of abroadCountries) {
    registeredTotal += ac.registered_voters;
    for (const p of ac.parties) {
      if (isCikEligible(p.party_id)) cikTotal += p.votes;
      const existing = byName.get(p.name);
      if (existing) {
        existing.votes += p.votes;
      } else {
        byName.set(p.name, {
          color: p.color || "#555",
          votes: p.votes,
          partyId: p.party_id,
        });
      }
    }
  }
  const result: AggregatedParty[] = [];
  for (const [name, { color, votes, partyId }] of byName) {
    result.push({
      name,
      color,
      totalVotes: votes,
      pctRegistered: registeredTotal > 0 ? (votes / registeredTotal) * 100 : 0,
      pctCik:
        isCikEligible(partyId) && cikTotal > 0 ? (votes / cikTotal) * 100 : null,
    });
  }
  result.sort((a, b) => b.totalVotes - a.totalVotes);
  return result;
}

// Aggregate for a single region
function aggregateRegionParties(
  region: GeoRegion,
  showNonVoters: boolean,
): AggregatedParty[] {
  const registeredTotal = region.registered_voters;
  const cikTotal = region.parties
    .filter((p) => isCikEligible(p.party_id))
    .reduce((sum, p) => sum + p.votes, 0);

  if (registeredTotal <= 0) return [];

  const result: AggregatedParty[] = [];

  for (const p of region.parties) {
    result.push({
      name: p.name,
      color: p.color || "#555",
      totalVotes: p.votes,
      pctRegistered: (p.votes / registeredTotal) * 100,
      pctCik:
        isCikEligible(p.party_id) && cikTotal > 0
          ? (p.votes / cikTotal) * 100
          : null,
    });
  }
  if (showNonVoters) {
    const nv = region.registered_voters - region.actual_voters;
    if (nv > 0) {
      result.push({
        name: "Негласували",
        color: NON_VOTER_COLOR,
        totalVotes: nv,
        pctRegistered: (nv / registeredTotal) * 100,
        pctCik: null,
      });
    }
  }

  result.sort((a, b) => b.totalVotes - a.totalVotes);
  return result;
}

// Build the MapLibre fill-opacity expression based on active filters
function buildOpacityExpression(
  activeParty: string | null,
  selectedRegionId: number | null,
): MapLibreGL.ExpressionSpecification | number {
  if (activeParty && selectedRegionId != null) {
    return [
      "case",
      ["all",
        ["==", ["get", "party_name"], activeParty],
        ["==", ["get", "region_id"], selectedRegionId],
      ],
      1,
      0.06,
    ];
  }
  if (activeParty) {
    return [
      "case",
      ["==", ["get", "party_name"], activeParty],
      1,
      0.06,
    ];
  }
  if (selectedRegionId != null) {
    return [
      "case",
      ["==", ["get", "region_id"], selectedRegionId],
      0.9,
      0.12,
    ];
  }
  return 0.9;
}

function TileDensityLayer({
  regions,
  showNonVoters,
  geoLevel,
  activeParty,
  selectedRegionId,
  hoveredRegionId,
  onRegionClick,
  onRegionHover,
}: {
  regions: GeoRegion[];
  showNonVoters: boolean;
  geoLevel: GeoLevel;
  activeParty: string | null;
  selectedRegionId: number | null;
  hoveredRegionId: number | null;
  onRegionClick: (regionId: number, lngLat: [number, number]) => void;
  onRegionHover: (regionId: number | null) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onRegionClick);
  onClickRef.current = onRegionClick;
  const onHoverRef = useRef(onRegionHover);
  onHoverRef.current = onRegionHover;

  const tileData = useMemo(
    () => computeAllTiles(regions, showNonVoters, geoLevel),
    [regions, showNonVoters, geoLevel],
  );

  const borderData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: regions.map((r) => ({
        type: "Feature" as const,
        geometry: r.geo,
        properties: { id: r.id, name: r.name },
      })),
    }),
    [regions],
  );

  // Fit the viewport to the full set of municipalities on first load
  // so Bulgaria is always fully in frame regardless of container size
  // (mobile portrait, desktop with legend sidebar, etc). The extra
  // top padding accounts for the absolute-positioned controls row,
  // which can wrap to two lines on narrow viewports.
  //
  // The fit is deferred with a double-rAF + explicit `map.resize()`
  // because on first mount the flex parent hasn't resolved its final
  // height yet — fitting against the stale size made Bulgaria
  // overflow the bottom once the legend sibling pushed the map
  // container shorter.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || fittedRef.current || regions.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of regions) {
      const [x1, y1, x2, y2] = bbox(r.geo as any);
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    if (!isFinite(minX)) return;

    const runFit = () => {
      map.resize();
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        {
          padding: { top: 96, bottom: 32, left: 24, right: 24 },
          animate: false,
          maxZoom: 8,
        },
      );
      fittedRef.current = true;
    };

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(runFit);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [map, isLoaded, regions]);

  // Update fill-opacity reactively
  useEffect(() => {
    if (!map || !isLoaded || !map.getLayer(TILE_LAYER)) return;
    const expr = buildOpacityExpression(activeParty, selectedRegionId);
    map.setPaintProperty(TILE_LAYER, "fill-opacity", expr);
  }, [map, isLoaded, activeParty, selectedRegionId]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const existing = map.getSource(TILE_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(tileData as any);
    } else {
      map.addSource(TILE_SOURCE, { type: "geojson", data: tileData as any });
      map.addLayer({
        id: TILE_LAYER,
        type: "fill",
        source: TILE_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.9,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(TILE_LAYER)) map.removeLayer(TILE_LAYER);
        if (map.getSource(TILE_SOURCE)) map.removeSource(TILE_SOURCE);
      } catch { /* destroyed */ }
    };
  }, [map, isLoaded, tileData]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const existing = map.getSource(BORDER_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(borderData as any);
    } else {
      map.addSource(BORDER_SOURCE, { type: "geojson", data: borderData as any });
      map.addLayer({
        id: BORDER_LAYER,
        type: "line",
        source: BORDER_SOURCE,
        paint: { "line-color": "#666", "line-width": 1 },
      });
    }

    return () => {
      try {
        if (map.getLayer(BORDER_LAYER)) map.removeLayer(BORDER_LAYER);
        if (map.getSource(BORDER_SOURCE)) map.removeSource(BORDER_SOURCE);
      } catch { /* destroyed */ }
    };
  }, [map, isLoaded, borderData]);

  // Highlight the hovered municipality's outline so the user can see
  // *where* the tooltip data lives, even while mousing over tiles far
  // from the boundary. Selected regions also get a thicker outline.
  useEffect(() => {
    if (!map || !isLoaded || !map.getLayer(BORDER_LAYER)) return;
    const widthExpr: MapLibreGL.ExpressionSpecification | number =
      hoveredRegionId != null || selectedRegionId != null
        ? [
            "case",
            ["==", ["get", "id"], hoveredRegionId ?? -1],
            2.5,
            ["==", ["get", "id"], selectedRegionId ?? -1],
            2,
            0.6,
          ]
        : 1;
    const colorExpr: MapLibreGL.ExpressionSpecification | string =
      hoveredRegionId != null || selectedRegionId != null
        ? [
            "case",
            ["==", ["get", "id"], hoveredRegionId ?? -1],
            "#111",
            ["==", ["get", "id"], selectedRegionId ?? -1],
            "#333",
            "#777",
          ]
        : "#666";
    map.setPaintProperty(BORDER_LAYER, "line-width", widthExpr);
    map.setPaintProperty(BORDER_LAYER, "line-color", colorExpr);
  }, [map, isLoaded, hoveredRegionId, selectedRegionId]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [TILE_LAYER] });
      if (!features.length) return;
      const regionId = features[0].properties?.region_id;
      if (regionId != null) {
        onClickRef.current(regionId, [e.lngLat.lng, e.lngLat.lat]);
      }
    };

    const handleEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      onHoverRef.current(null);
    };

    const handleMove = (e: MapLibreGL.MapLayerMouseEvent) => {
      const regionId = e.features?.[0]?.properties?.region_id;
      if (typeof regionId === "number") onHoverRef.current(regionId);
    };

    map.on("click", TILE_LAYER, handleClick);
    map.on("mouseenter", TILE_LAYER, handleEnter);
    map.on("mouseleave", TILE_LAYER, handleLeave);
    map.on("mousemove", TILE_LAYER, handleMove);

    // Click on empty space clears region selection
    map.on("click", (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [TILE_LAYER] });
      if (!features.length) {
        onClickRef.current(-1, [e.lngLat.lng, e.lngLat.lat]);
      }
    });

    return () => {
      map.off("click", TILE_LAYER, handleClick);
      map.off("mouseenter", TILE_LAYER, handleEnter);
      map.off("mouseleave", TILE_LAYER, handleLeave);
      map.off("mousemove", TILE_LAYER, handleMove);
    };
  }, [map, isLoaded]);

  return null;
}

interface LegendStats {
  registered: number;
  actual: number;
  turnoutPct: number;
}

function PartyLegend({
  parties,
  title,
  stats,
  activeParty,
  tappedParty,
  interactive,
  canClear,
  onHover,
  onTap,
  onClear,
}: {
  parties: AggregatedParty[];
  title: string | null;
  stats: LegendStats;
  activeParty: string | null;
  tappedParty: string | null;
  /** When false, party-row hover/tap does nothing and there's no
   *  hover affordance. Used for the read-only map-hover preview. */
  interactive: boolean;
  /** Whether to render the × clear button. True iff something is
   *  actually locked in (a selected region/country). */
  canClear: boolean;
  onHover: (name: string | null) => void;
  onTap: (name: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 border-b bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {title ?? "Всички региони"}
          </span>
          {canClear && (
            <button
              onClick={onClear}
              className="shrink-0 text-2xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs tabular-nums text-muted-foreground">
          <span>{stats.registered.toLocaleString("bg-BG")} рег.</span>
          <span>{stats.actual.toLocaleString("bg-BG")} гл.</span>
          <span className="font-medium text-foreground">{stats.turnoutPct.toFixed(2)}%</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-1">
        {parties.map((p) => {
          const isActive = activeParty === p.name;
          const isMuted = activeParty != null && !isActive;
          const isTapped = tappedParty === p.name;
          const rowClass = interactive
            ? `${isActive ? "bg-muted" : "hover:bg-muted/40"} cursor-pointer`
            : "cursor-default";
          return (
            <button
              key={p.name}
              type="button"
              disabled={!interactive}
              onClick={interactive ? () => onTap(p.name) : undefined}
              onMouseEnter={interactive ? () => onHover(p.name) : undefined}
              onMouseLeave={interactive ? () => onHover(null) : undefined}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-opacity ${rowClass} ${
                isMuted ? "opacity-30" : ""
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${isTapped ? "ring-1 ring-foreground ring-offset-1" : ""}`}
                style={{ background: p.color }}
              />
              <span className="min-w-0 flex-1 truncate text-xs">
                {p.name}
              </span>
              <span
                className="shrink-0 text-2xs tabular-nums text-muted-foreground"
                title="Брой гласове за тази опция"
              >
                {p.totalVotes.toLocaleString("bg-BG")}
              </span>
              <span
                className="w-11 shrink-0 text-right text-2xs tabular-nums text-muted-foreground/60"
                title="Дял от всички избиратели в списъка (включва негласували). Показва колко от общо избирателите са гласували за тази опция."
              >
                {p.pctRegistered.toFixed(2)}%
              </span>
              <span
                className="w-12 shrink-0 text-right text-2xs font-medium tabular-nums text-foreground"
                title="Дял от гласовете за партии по правилата на ЦИК: изключва негласувалите и 'не подкрепям никого'. Това е процентът, по който се определя 4% праг за парламента."
              >
                {p.pctCik !== null ? `${p.pctCik.toFixed(2)}%` : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DistrictPieMap() {
  const { electionId } = useParams<{ electionId: string }>();

  const [searchParams, setSearchParams] = useSearchParams();
  // Tab state lives in the URL (`?tab=mir|abroad`) so each view is
  // directly shareable. Defaults to "bg" (municipalities) when missing.
  const rawTab = searchParams.get("tab");
  const tab: "mir" | "bg" | "abroad" =
    rawTab === "abroad" ? "abroad" : rawTab === "mir" ? "mir" : "bg";

  // Read initial state from URL params so shared links preserve context
  const initialRegionId = searchParams.get("region");
  const initialNonVoters = searchParams.get("nonVoters");

  const [showNonVoters, setShowNonVoters] = useState(
    initialNonVoters === "0" ? false : true,
  );
  const geoLevel: GeoLevel = tab === "mir" ? "riks" : "municipalities";
  const [selectedRegion, setSelectedRegion] = useState<GeoRegion | null>(null);
  const [pendingRegionId] = useState<number | null>(
    initialRegionId ? Number(initialRegionId) : null,
  );
  const [selectedIsoCountry, setSelectedIsoCountry] = useState<string | null>(
    null,
  );
  const [hoveredRegionId, setHoveredRegionId] = useState<number | null>(null);
  const [hoveredIsoCountry, setHoveredIsoCountry] = useState<string | null>(
    null,
  );
  const [hoveredParty, setHoveredParty] = useState<string | null>(null);
  const [tappedParty, setTappedParty] = useState<string | null>(null);

  // Active party = hover takes priority over tap
  const activeParty = hoveredParty ?? tappedParty;

  const {
    data: geoData,
    isLoading: loading,
    error: queryError,
  } = useGeoResults(electionId, geoLevel);
  const { data: abroadData } = useAbroadByCountry(electionId);
  const election: Election | null = geoData?.election ?? null;
  const regions: GeoRegion[] = (geoData?.areas ?? []) as GeoRegion[];
  const abroadCountries: AbroadCountry[] = abroadData?.countries ?? [];
  const error = queryError instanceof Error ? queryError.message : null;
  const isLocalElection = election?.type.startsWith("local_") ?? false;

  // Reset transient selection state whenever the underlying dataset changes.
  useEffect(() => {
    setSelectedRegion(null);
    setSelectedIsoCountry(null);
    setHoveredRegionId(null);
    setHoveredIsoCountry(null);
    setHoveredParty(null);
    setTappedParty(null);
  }, [electionId, geoLevel]);

  const regionMap = useMemo(
    () => new globalThis.Map(regions.map((r) => [r.id, r])),
    [regions],
  );

  // Restore region selection from URL param once data loads
  useEffect(() => {
    if (pendingRegionId != null && regions.length > 0 && !selectedRegion) {
      const region = regionMap.get(pendingRegionId);
      if (region) setSelectedRegion(region);
    }
  }, [pendingRegionId, regions, regionMap, selectedRegion]);

  // Sync selection state back to URL for sharing
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (selectedRegion) params.set("region", String(selectedRegion.id));
        else params.delete("region");
        if (!showNonVoters) params.set("nonVoters", "0");
        else params.delete("nonVoters");
        return params;
      },
      { replace: true },
    );
  }, [selectedRegion, showNonVoters, setSearchParams]);

  const hoveredRegion = useMemo(
    () => (hoveredRegionId != null ? regionMap.get(hoveredRegionId) ?? null : null),
    [hoveredRegionId, regionMap],
  );

  const hoveredCountry = useMemo(
    () =>
      hoveredIsoCountry
        ? abroadCountries.find((c) => c.iso2 === hoveredIsoCountry) ?? null
        : null,
    [hoveredIsoCountry, abroadCountries],
  );

  // National-level or region-level party list
  const nationalParties = useMemo(
    () => aggregateParties(regions, showNonVoters, abroadCountries),
    [regions, showNonVoters, abroadCountries],
  );

  const regionParties = useMemo(
    () => selectedRegion ? aggregateRegionParties(selectedRegion, showNonVoters) : null,
    [selectedRegion, showNonVoters],
  );

  const selectedCountry = useMemo(
    () =>
      selectedIsoCountry
        ? abroadCountries.find((c) => c.iso2 === selectedIsoCountry) ?? null
        : null,
    [selectedIsoCountry, abroadCountries],
  );

  const countryParties = useMemo(
    () => (selectedCountry ? aggregateAbroadCountryParties(selectedCountry) : null),
    [selectedCountry],
  );

  // Hover previews — same shape as the "selected" aggregates but
  // only used when nothing is clicked/locked.
  const hoveredRegionParties = useMemo(
    () =>
      hoveredRegion ? aggregateRegionParties(hoveredRegion, showNonVoters) : null,
    [hoveredRegion, showNonVoters],
  );

  const hoveredCountryParties = useMemo(
    () => (hoveredCountry ? aggregateAbroadCountryParties(hoveredCountry) : null),
    [hoveredCountry],
  );

  // A map hover is previewed in the legend only when nothing is
  // locked in. Selection always wins. In preview mode the legend is
  // rendered non-interactively: no party-tap, no hover highlighting
  // of tiles, because the user is driving the state with the cursor
  // over the map, not the legend.
  const isHoverPreview =
    !selectedRegion &&
    !selectedCountry &&
    (hoveredRegion != null || hoveredCountry != null);

  // National aggregate for the Abroad tab (sum across all countries).
  // The Bulgaria tab uses `nationalParties` which already merges abroad
  // into the CIK denominator (see aggregateParties).
  const abroadNationalParties = useMemo(
    () => aggregateAbroadNationalParties(abroadCountries),
    [abroadCountries],
  );

  const legendParties = useMemo(() => {
    // Priority: selected > hovered > tab default.
    if (countryParties) return countryParties;
    if (regionParties) return regionParties;
    if (hoveredCountryParties) return hoveredCountryParties;
    if (hoveredRegionParties) return hoveredRegionParties;
    return tab === "abroad" ? abroadNationalParties : nationalParties;
  }, [
    countryParties,
    regionParties,
    hoveredCountryParties,
    hoveredRegionParties,
    tab,
    abroadNationalParties,
    nationalParties,
  ]);

  const legendTitle =
    selectedCountry?.name ??
    selectedRegion?.name ??
    hoveredCountry?.name ??
    hoveredRegion?.name ??
    (tab === "abroad" ? "Всички държави" : null);

  const legendStats = useMemo((): LegendStats => {
    if (selectedCountry) {
      return {
        registered: selectedCountry.registered_voters,
        actual: selectedCountry.actual_voters,
        turnoutPct: 100, // abroad has no meaningful "not showed up" pool
      };
    }
    if (selectedRegion) {
      const registered = selectedRegion.registered_voters;
      const actual = selectedRegion.actual_voters;
      return {
        registered,
        actual,
        turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
      };
    }
    if (hoveredCountry) {
      return {
        registered: hoveredCountry.registered_voters,
        actual: hoveredCountry.actual_voters,
        turnoutPct: 100,
      };
    }
    if (hoveredRegion) {
      const registered = hoveredRegion.registered_voters;
      const actual = hoveredRegion.actual_voters;
      return {
        registered,
        actual,
        turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
      };
    }
    if (tab === "abroad") {
      let registered = 0;
      let actual = 0;
      for (const ac of abroadCountries) {
        registered += ac.registered_voters;
        actual += ac.actual_voters;
      }
      return {
        registered,
        actual,
        turnoutPct: 100,
      };
    }
    // Bulgaria tab national: include abroad (registered == actual
    // there) so the stat row matches the denominator used by
    // `aggregateParties`, which keeps Velichie at 4.00% (not 3.77).
    let registered = 0;
    let actual = 0;
    for (const r of regions) {
      registered += r.registered_voters;
      actual += r.actual_voters;
    }
    for (const ac of abroadCountries) {
      registered += ac.registered_voters;
      actual += ac.actual_voters;
    }
    return {
      registered,
      actual,
      turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
    };
  }, [
    regions,
    selectedRegion,
    selectedCountry,
    hoveredRegion,
    hoveredCountry,
    abroadCountries,
    tab,
  ]);

  const handleRegionClick = useCallback(
    (regionId: number, _lngLat: [number, number]) => {
      if (regionId === -1) {
        // Click on empty space
        setSelectedRegion(null);
        return;
      }
      const region = regionMap.get(regionId);
      if (!region) return;
      const isSelecting = region.id !== undefined;
      if (isSelecting) trackEvent("click_region", { region_id: regionId, region_name: region.name, election_id: electionId });
      setSelectedRegion((prev) => prev?.id === regionId ? null : region);
      setSelectedIsoCountry(null);
      setTappedParty(null);
    },
    [regionMap, electionId],
  );

  const handleCountrySelect = useCallback(
    (iso: string | null) => {
      if (iso) {
        trackEvent("click_abroad_country", { iso2: iso, election_id: electionId });
      }
      setSelectedIsoCountry((prev) => (prev === iso ? null : iso));
      setSelectedRegion(null);
      setTappedParty(null);
    },
    [electionId],
  );

  const handlePartyTap = useCallback((name: string) => {
    trackEvent("tap_party", { party_name: name, election_id: electionId });
    setTappedParty((prev) => prev === name ? null : name);
  }, [electionId]);

  const handleClear = useCallback(() => {
    setSelectedRegion(null);
    setSelectedIsoCountry(null);
    setTappedParty(null);
    setHoveredParty(null);
  }, []);

  const handleTabChange = useCallback(
    (next: "mir" | "bg" | "abroad") => {
      if (next === tab) return;
      trackEvent("switch_results_tab", { tab: next, election_id: electionId });
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "bg") params.delete("tab");
          else params.set("tab", next);
          return params;
        },
        { replace: false },
      );
      setSelectedRegion(null);
      setSelectedIsoCountry(null);
      setHoveredRegionId(null);
      setHoveredIsoCountry(null);
      setTappedParty(null);
      setHoveredParty(null);
    },
    [tab, electionId, setSearchParams],
  );

  if (isLocalElection) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-md border bg-background px-6 py-4 text-center shadow-sm">
          <div className="text-sm font-medium">Местни избори</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Резултатите от местните избори все още не са налични в тази визуализация.
            <br />
            Използвайте Секции или Таблица за достъп до данните.
          </div>
        </div>
      </div>
    );
  }

  return (
    // Flex layout: map fills the remaining space, legend is a sibling
    // panel (not an overlay). On mobile the two stack vertically; the
    // legend is capped at ~45vh with internal scroll so the map stays
    // usable. On ≥md it's a 320px column on the right.
    //
    // If the legend height feels cramped on small phones we can swap
    // the mobile layout for a collapsible bottom-sheet: wrap the
    // <aside> in a controlled `collapsed` state and toggle between
    // `h-10` (just the title bar) and `max-h-[45vh]` on a chevron tap.
    <div className="flex h-full w-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1">
          {/* Top-left controls — still overlaid on the map */}
        <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1.5 md:top-3 md:left-3 md:gap-2">
          {/* Tab switcher — МИР / Общини / Чужбина */}
          <div className="inline-flex overflow-hidden rounded-md border bg-background/95 shadow-md backdrop-blur-sm">
            <button
              type="button"
              onClick={() => handleTabChange("mir")}
              className={`px-3 py-2 text-xs transition-colors ${
                tab === "mir"
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              МИР
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("bg")}
              className={`border-l px-3 py-2 text-xs transition-colors ${
                tab === "bg"
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              Общини
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("abroad")}
              className={`border-l px-3 py-2 text-xs transition-colors ${
                tab === "abroad"
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              Чужбина
            </button>
          </div>

          {loading && !election && (
            <div className="rounded-md border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm">
              <span className="text-xs text-muted-foreground">Зареждане...</span>
            </div>
          )}
          {error && (
            <div className="rounded-md border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm">
              <span className="text-xs text-score-high">{error}</span>
            </div>
          )}
          {tab !== "abroad" && (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm">
              <input
                type="checkbox"
                checked={showNonVoters}
                onChange={(e) => setShowNonVoters(e.target.checked)}
                className="accent-primary"
              />
              Негласували
            </label>
          )}
        </div>

        {/* Map — swap full canvas between Bulgaria and world */}
        {tab !== "abroad" ? (
          <MapComponent
            center={BULGARIA_CENTER}
            zoom={BULGARIA_ZOOM}
            className="h-full w-full"
            loading={loading}
            styles={{ light: BLANK_STYLE as any, dark: BLANK_STYLE as any }}
          >
            {regions.length > 0 && (
              <>
                <TileDensityLayer
                  regions={regions}
                  showNonVoters={showNonVoters}
                  geoLevel={geoLevel}
                  activeParty={activeParty}
                  selectedRegionId={selectedRegion?.id ?? null}
                  hoveredRegionId={hoveredRegionId}
                  onRegionClick={handleRegionClick}
                  onRegionHover={setHoveredRegionId}
                />
                <MapControls />
              </>
            )}
          </MapComponent>
        ) : (
          <AbroadMap
            electionId={electionId}
            selectedIso={selectedIsoCountry}
            hoveredIso={hoveredIsoCountry}
            activeParty={isHoverPreview ? null : activeParty}
            onSelect={handleCountrySelect}
            onHoverChange={setHoveredIsoCountry}
          />
        )}
      </div>

      {/* Right-side legend panel. Sibling of the map, so the map's
          effective width is viewport − 320px on desktop and the
          country polygons never get clipped behind a popup. */}
      {legendParties.length > 0 && (
        <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t md:max-h-none md:h-full md:w-80 md:border-l md:border-t-0">
          <PartyLegend
            parties={legendParties}
            title={legendTitle}
            stats={legendStats}
            activeParty={isHoverPreview ? null : activeParty}
            tappedParty={isHoverPreview ? null : tappedParty}
            interactive={!isHoverPreview}
            canClear={selectedRegion != null || selectedIsoCountry != null}
            onHover={setHoveredParty}
            onTap={handlePartyTap}
            onClear={handleClear}
          />
        </aside>
      )}
      </div>
    </div>
  );
}
