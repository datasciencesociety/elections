import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router";
import { Map as MapComponent, useMap, MapControls } from "@/components/ui/map";
import Sidebar from "@/components/sidebar.js";
import MapLibreGL from "maplibre-gl";
import bbox from "@turf/bbox";
import intersect from "@turf/intersect";
import { polygon as turfPolygon, featureCollection } from "@turf/helpers";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

interface PartyEntry {
  party_id: number;
  name: string;
  color: string;
  votes: number;
  pct: number;
}

// Unified shape for both districts and municipalities
interface GeoRegion {
  id: number;
  name: string;
  geo: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  registered_voters: number;
  actual_voters: number;
  non_voters: number;
  total_votes: number;
  winner: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  } | null;
  parties: PartyEntry[];
}

type GeoLevel = "districts" | "municipalities" | "riks";

const BULGARIA_CENTER: [number, number] = [25.5, 42.7];
const BULGARIA_ZOOM = 7;
const NON_VOTER_COLOR = "#d4d4d4";
const SPLIT_SOURCE = "region-splits";
const SPLIT_FILL_LAYER = "region-splits-fill";
const BORDER_SOURCE = "region-borders";
const BORDER_LAYER = "region-borders-line";

function buildSplitFeatures(
  region: GeoRegion,
  showNonVoters: boolean,
): GeoJSON.Feature[] {
  const geo = region.geo;
  if (!geo) return [];

  const [minX, minY, maxX, maxY] = bbox({ type: "Feature", geometry: geo, properties: {} });
  const height = maxY - minY;
  if (height <= 0) return [];

  type Slice = { label: string; color: string; share: number };
  const slices: Slice[] = [];
  const total = showNonVoters ? region.registered_voters : region.total_votes;
  if (total <= 0) return [];

  const OTHER_COLOR = "#999";
  const MIN_SHARE = 0.02; // 2% threshold — parties below this get merged into "Other"
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
    slices.push({ label: "Other", color: OTHER_COLOR, share: otherShare });
  }
  if (showNonVoters) {
    const nv = region.registered_voters - region.actual_voters;
    if (nv > 0) {
      slices.push({ label: "Non-voters", color: NON_VOTER_COLOR, share: nv / total });
    }
  }

  slices.sort((a, b) => b.share - a.share);

  const features: GeoJSON.Feature[] = [];
  let cumY = minY;
  const pad = 0.001;

  for (const slice of slices) {
    const bandHeight = slice.share * height;
    if (bandHeight < 0.0001) continue;

    const y0 = cumY - pad;
    const y1 = cumY + bandHeight + pad;
    cumY += bandHeight;

    const clipCoords: [number, number][] = [
      [minX - 1, y0],
      [maxX + 1, y0],
      [maxX + 1, y1],
      [minX - 1, y1],
      [minX - 1, y0],
    ];

    try {
      const clipPoly = turfPolygon([clipCoords]);
      const regionFeature = { type: "Feature" as const, geometry: geo, properties: {} };
      const clipped = intersect(
        featureCollection([regionFeature as any, clipPoly]),
      );

      if (clipped) {
        features.push({
          type: "Feature",
          geometry: clipped.geometry,
          properties: {
            region_id: region.id,
            region_name: region.name,
            party_name: slice.label,
            color: slice.color,
            share: Math.round(slice.share * 10000) / 100,
          },
        });
      }
    } catch {
      // skip degenerate geometries
    }
  }

  return features;
}

function computeAllSplits(
  regions: GeoRegion[],
  showNonVoters: boolean,
): GeoJSON.FeatureCollection {
  const allFeatures: GeoJSON.Feature[] = [];
  for (const r of regions) {
    allFeatures.push(...buildSplitFeatures(r, showNonVoters));
  }
  return { type: "FeatureCollection", features: allFeatures };
}

function SplitPolygonLayer({
  regions,
  showNonVoters,
  onRegionClick,
}: {
  regions: GeoRegion[];
  showNonVoters: boolean;
  onRegionClick: (regionId: number, lngLat: [number, number]) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onRegionClick);
  onClickRef.current = onRegionClick;

  const splitData = useMemo(
    () => computeAllSplits(regions, showNonVoters),
    [regions, showNonVoters],
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

  useEffect(() => {
    if (!map || !isLoaded) return;

    const existing = map.getSource(SPLIT_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(splitData as any);
    } else {
      map.addSource(SPLIT_SOURCE, {
        type: "geojson",
        data: splitData as any,
      });
      map.addLayer({
        id: SPLIT_FILL_LAYER,
        type: "fill",
        source: SPLIT_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.85,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(SPLIT_FILL_LAYER)) map.removeLayer(SPLIT_FILL_LAYER);
        if (map.getSource(SPLIT_SOURCE)) map.removeSource(SPLIT_SOURCE);
      } catch { /* map already destroyed */ }
    };
  }, [map, isLoaded, splitData]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const existing = map.getSource(BORDER_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(borderData as any);
    } else {
      map.addSource(BORDER_SOURCE, {
        type: "geojson",
        data: borderData as any,
      });
      map.addLayer({
        id: BORDER_LAYER,
        type: "line",
        source: BORDER_SOURCE,
        paint: {
          "line-color": "#333",
          "line-width": 1.5,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(BORDER_LAYER)) map.removeLayer(BORDER_LAYER);
        if (map.getSource(BORDER_SOURCE)) map.removeSource(BORDER_SOURCE);
      } catch { /* map already destroyed */ }
    };
  }, [map, isLoaded, borderData]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [SPLIT_FILL_LAYER],
      });
      if (!features.length) return;
      const regionId = features[0].properties?.region_id;
      if (regionId != null) {
        onClickRef.current(regionId, [e.lngLat.lng, e.lngLat.lat]);
      }
    };

    const handleEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const handleLeave = () => { map.getCanvas().style.cursor = ""; };

    map.on("click", SPLIT_FILL_LAYER, handleClick);
    map.on("mouseenter", SPLIT_FILL_LAYER, handleEnter);
    map.on("mouseleave", SPLIT_FILL_LAYER, handleLeave);

    return () => {
      map.off("click", SPLIT_FILL_LAYER, handleClick);
      map.off("mouseenter", SPLIT_FILL_LAYER, handleEnter);
      map.off("mouseleave", SPLIT_FILL_LAYER, handleLeave);
    };
  }, [map, isLoaded]);

  return null;
}

function fetchRegions(
  electionId: string,
  level: GeoLevel,
): Promise<{ election: Election; regions: GeoRegion[] }> {
  return fetch(`/api/elections/${electionId}/results/geo/${level}`)
    .then((res) => {
      if (res.status === 404) throw new Error("Election not found");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => ({
      election: data.election,
      regions: data[level] as GeoRegion[],
    }));
}

export default function DistrictPieMap() {
  const { electionId } = useParams<{ electionId: string }>();

  const [election, setElection] = useState<Election | null>(null);
  const [regions, setRegions] = useState<GeoRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNonVoters, setShowNonVoters] = useState(true);
  const [geoLevel, setGeoLevel] = useState<GeoLevel>("municipalities");
  const [selectedRegion, setSelectedRegion] = useState<GeoRegion | null>(null);

  useEffect(() => {
    if (!electionId) return;
    setLoading(true);
    setError(null);
    setRegions([]);
    setElection(null);
    setSelectedRegion(null);

    fetchRegions(electionId, geoLevel)
      .then(({ election: el, regions: r }) => {
        setElection(el);
        setRegions(r);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [electionId, geoLevel]);

  const regionMap = useMemo(
    () => new globalThis.Map(regions.map((r) => [r.id, r])),
    [regions],
  );

  const handleRegionClick = useCallback(
    (regionId: number, _lngLat: [number, number]) => {
      const region = regionMap.get(regionId);
      if (!region) return;
      setSelectedRegion((prev) =>
        prev?.id === regionId ? null : region,
      );
    },
    [regionMap],
  );

  return (
    <div className="relative h-full w-full">
      {/* Top-left controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
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
        <div className="flex items-center gap-1 rounded-md border bg-background/95 px-1 py-1 shadow-md backdrop-blur-sm">
          {(["riks", "districts", "municipalities"] as GeoLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => { setSelectedRegion(null); setGeoLevel(level); }}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                geoLevel === level
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {level === "riks" ? "МИР" : level === "districts" ? "Области" : "Общини"}
            </button>
          ))}
        </div>
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

      {/* Map */}
      <MapComponent
        center={BULGARIA_CENTER}
        zoom={BULGARIA_ZOOM}
        className="h-full w-full"
        loading={loading}
      >
        {regions.length > 0 && (
          <>
            <SplitPolygonLayer
              regions={regions}
              showNonVoters={showNonVoters}
              onRegionClick={handleRegionClick}
            />
            <MapControls />
          </>
        )}
      </MapComponent>

      {/* Sidebar */}
      <Sidebar
        open={!!selectedRegion}
        onClose={() => setSelectedRegion(null)}
        title={selectedRegion?.name}
      >
        {selectedRegion && (
          <PopupContent
            region={selectedRegion}
            showNonVoters={showNonVoters}
          />
        )}
      </Sidebar>
    </div>
  );
}

function PopupContent({
  region,
  showNonVoters,
}: {
  region: GeoRegion;
  showNonVoters: boolean;
}) {
  const turnoutPct =
    region.registered_voters > 0
      ? ((region.actual_voters / region.registered_voters) * 100).toFixed(1)
      : "0";

  const topParties = region.parties.slice(0, 8);

  return (
    <div className="min-w-[220px] max-w-[280px]">
      <div className="mb-1 text-sm font-semibold">{region.name}</div>
      <div className="text-muted-foreground mb-2 text-xs">
        {region.registered_voters.toLocaleString()} registered | {turnoutPct}%
        turnout
      </div>
      <div className="space-y-1">
        {topParties.map((p) => (
          <div key={p.party_id} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: p.color }}
            />
            <span className="min-w-0 flex-1 truncate text-xs">{p.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {p.pct.toFixed(1)}%
            </span>
          </div>
        ))}
        {showNonVoters && (
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: NON_VOTER_COLOR }}
            />
            <span className="min-w-0 flex-1 truncate text-xs">Non-voters</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {(
                ((region.registered_voters - region.actual_voters) /
                  region.registered_voters) *
                100
              ).toFixed(1)}
              %
            </span>
          </div>
        )}
        {region.parties.length > 8 && (
          <div className="text-muted-foreground text-[11px]">
            +{region.parties.length - 8} more
          </div>
        )}
      </div>
    </div>
  );
}
