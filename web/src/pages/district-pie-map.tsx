import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map as MapComponent, useMap, MapControls } from "@/components/ui/map";
import MapLibreGL from "maplibre-gl";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import { useGeoResults } from "@/lib/hooks/use-geo-results.js";
import type { GeoLevel } from "@/lib/api/geo-results.js";
import type { Election, GeoArea } from "@/lib/api/types.js";

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

// Shifted north + slightly zoomed out so the synthetic "Чужбина" circle
// (center [25.5, 44.9], radius 0.4°) above Bulgaria is in the initial
// viewport with padding from the country.
const BULGARIA_CENTER: [number, number] = [25.3, 43.4];
const BULGARIA_ZOOM = 6.8;
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
    case "riks": return 0.06;
    case "districts": return 0.04;
    case "municipalities": return 0.02;
  }
}

function computeAllTiles(
  regions: GeoRegion[],
  showNonVoters: boolean,
  level: GeoLevel,
): GeoJSON.FeatureCollection {
  const step = getGridStep(level);
  const allFeatures: GeoJSON.Feature[] = [];
  for (const r of regions) {
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
): AggregatedParty[] {
  const byName = new Map<
    string,
    { color: string; votes: number; partyId: number }
  >();
  let registeredTotal = 0;
  let cikTotal = 0;

  for (const r of regions) {
    registeredTotal += r.registered_voters;
    for (const p of r.parties) {
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
  onRegionClick,
}: {
  regions: GeoRegion[];
  showNonVoters: boolean;
  geoLevel: GeoLevel;
  activeParty: string | null;
  selectedRegionId: number | null;
  onRegionClick: (regionId: number, lngLat: [number, number]) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onRegionClick);
  onClickRef.current = onRegionClick;

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
    const handleLeave = () => { map.getCanvas().style.cursor = ""; };

    map.on("click", TILE_LAYER, handleClick);
    map.on("mouseenter", TILE_LAYER, handleEnter);
    map.on("mouseleave", TILE_LAYER, handleLeave);

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
  onHover,
  onTap,
  onClear,
}: {
  parties: AggregatedParty[];
  title: string | null;
  stats: LegendStats;
  activeParty: string | null;
  tappedParty: string | null;
  onHover: (name: string | null) => void;
  onTap: (name: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="absolute bottom-2 left-2 right-2 z-10 max-h-[40vh] w-auto overflow-y-auto rounded-md border bg-background/95 shadow-md backdrop-blur-sm md:bottom-auto md:left-auto md:top-3 md:right-3 md:max-h-[calc(100%-1rem)] md:w-80">
      <div className="sticky top-0 border-b bg-background/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-medium">
            {title ?? "Всички региони"}
          </span>
          {(activeParty || title) && (
            <button
              onClick={onClear}
              className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-1 flex gap-3 text-[10px] tabular-nums text-muted-foreground">
          <span>{stats.registered.toLocaleString("bg-BG")} рег.</span>
          <span>{stats.actual.toLocaleString("bg-BG")} гл.</span>
          <span className="font-medium text-foreground">{stats.turnoutPct.toFixed(2)}%</span>
        </div>
      </div>
      <div className="p-1">
        {parties.map((p) => {
          const isActive = activeParty === p.name;
          const isMuted = activeParty != null && !isActive;
          const isTapped = tappedParty === p.name;
          return (
            <button
              key={p.name}
              onClick={() => onTap(p.name)}
              onMouseEnter={() => onHover(p.name)}
              onMouseLeave={() => onHover(null)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-opacity ${
                isActive ? "bg-muted" : "hover:bg-muted/40"
              } ${isMuted ? "opacity-30" : ""}`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${isTapped ? "ring-1 ring-foreground ring-offset-1" : ""}`}
                style={{ background: p.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px]">
                {p.name}
              </span>
              <span
                className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
                title="Брой гласове за тази опция"
              >
                {p.totalVotes.toLocaleString("bg-BG")}
              </span>
              <span
                className="w-11 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60"
                title="Дял от всички избиратели в списъка (включва негласували). Показва колко от общо избирателите са гласували за тази опция."
              >
                {p.pctRegistered.toFixed(2)}%
              </span>
              <span
                className="w-12 shrink-0 text-right text-[10px] font-medium tabular-nums text-foreground"
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

  const [showNonVoters, setShowNonVoters] = useState(true);
  const [geoLevel] = useState<GeoLevel>("municipalities");
  const [selectedRegion, setSelectedRegion] = useState<GeoRegion | null>(null);
  const [hoveredParty, setHoveredParty] = useState<string | null>(null);
  const [tappedParty, setTappedParty] = useState<string | null>(null);

  // Active party = hover takes priority over tap
  const activeParty = hoveredParty ?? tappedParty;

  const {
    data: geoData,
    isLoading: loading,
    error: queryError,
  } = useGeoResults(electionId, geoLevel);
  const election: Election | null = geoData?.election ?? null;
  const regions: GeoRegion[] = (geoData?.areas ?? []) as GeoRegion[];
  const error = queryError instanceof Error ? queryError.message : null;
  const isLocalElection = election?.type.startsWith("local_") ?? false;

  // Reset transient selection state whenever the underlying dataset changes.
  useEffect(() => {
    setSelectedRegion(null);
    setHoveredParty(null);
    setTappedParty(null);
  }, [electionId, geoLevel]);

  const regionMap = useMemo(
    () => new globalThis.Map(regions.map((r) => [r.id, r])),
    [regions],
  );

  // National-level or region-level party list
  const nationalParties = useMemo(
    () => aggregateParties(regions, showNonVoters),
    [regions, showNonVoters],
  );

  const regionParties = useMemo(
    () => selectedRegion ? aggregateRegionParties(selectedRegion, showNonVoters) : null,
    [selectedRegion, showNonVoters],
  );

  const legendParties = regionParties ?? nationalParties;

  const legendStats = useMemo((): LegendStats => {
    const source = selectedRegion ? [selectedRegion] : regions;
    const registered = source.reduce((s, r) => s + r.registered_voters, 0);
    const actual = source.reduce((s, r) => s + r.actual_voters, 0);
    return {
      registered,
      actual,
      turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
    };
  }, [regions, selectedRegion]);

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
      setTappedParty(null);
    },
    [regionMap],
  );

  const handlePartyTap = useCallback((name: string) => {
    trackEvent("tap_party", { party_name: name, election_id: electionId });
    setTappedParty((prev) => prev === name ? null : name);
  }, [electionId]);

  const handleClear = useCallback(() => {
    setSelectedRegion(null);
    setTappedParty(null);
    setHoveredParty(null);
  }, []);

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
    <div className="relative h-full w-full">
      {/* Top-left controls */}
      <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1.5 md:top-3 md:left-3 md:gap-2">
        {loading && !election && (
          <div className="rounded-md border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm">
            <span className="text-xs text-muted-foreground">Зареждане...</span>
          </div>
        )}
        {error && (
          <div className="rounded-md border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm">
            <span className="text-xs text-red-600">{error}</span>
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm">
          <input
            type="checkbox"
            checked={showNonVoters}
            onChange={(e) => setShowNonVoters(e.target.checked)}
            className="accent-primary"
          />
          Негласували
        </label>
      </div>

      {/* Party legend — right side */}
      {legendParties.length > 0 && (
        <PartyLegend
          parties={legendParties}
          title={selectedRegion?.name ?? null}
          stats={legendStats}
          activeParty={activeParty}
          tappedParty={tappedParty}
          onHover={setHoveredParty}
          onTap={handlePartyTap}
          onClear={handleClear}
        />
      )}

      {/* Map */}
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
              onRegionClick={handleRegionClick}
            />
            <MapControls />
          </>
        )}
      </MapComponent>
    </div>
  );
}
