import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { Map, useMap } from "@/components/ui/map";
import Sidebar from "@/components/sidebar.js";
import LocationCorrection from "@/components/location-correction.js";
import MapLibreGL from "maplibre-gl";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

export interface RiskSection {
  section_code: string;
  settlement_name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  risk_score: number;
  benford_risk: number;
  peer_risk: number;
  acf_risk: number;
  turnout_rate: number;
  turnout_zscore: number;
  benford_score: number;
  benford_chi2: number;
  benford_p: number;
  ekatte_turnout_zscore: number;
  ekatte_turnout_zscore_norm: number;
  peer_vote_deviation: number;
  peer_vote_deviation_norm: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  acf_turnout_outlier: number;
  acf_winner_outlier: number;
  acf_invalid_outlier: number;
  acf_multicomponent: number;
  acf_turnout_shift: number | null;
  acf_turnout_shift_norm: number;
  acf_party_shift: number | null;
  acf_party_shift_norm: number;
  section_type: string;
}

interface AnomaliesResponse {
  election: Election;
  sections: RiskSection[];
  total: number;
  limit: number;
  offset: number;
}

interface GeoEntity {
  id: number;
  name: string;
}

type Methodology = "combined" | "benford" | "peer" | "acf";

interface SectionGeo {
  section_code: string;
  lat: number;
  lng: number;
  settlement_name: string;
  registered_voters: number;
  actual_voters: number;
  winner_party: string | null;
  winner_color: string;
  winner_pct: number;
  parties: { name: string; color: string; votes: number; pct: number }[];
}

// Truncate to 2 decimal places without rounding (3.999 → "3.99")
function pct2(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

// Build CIK protocol URLs for the latest elections (pe202410)
function buildProtocolLinks(sectionCode: string, electionId: number) {
  // Only for election 1 (27.10.2024) and 2 (27.10.2024 КС)
  const rik = sectionCode.slice(0, 2);
  if (electionId === 1) {
    return {
      protocol: `https://results.cik.bg/pe202410/rezultati/${rik}.html#/p/64/${sectionCode}.0.html`,
      scan: `https://results.cik.bg/pe202410/rezultati/${rik}.html#/s/64/${sectionCode}.0.pdf`,
      video: `https://evideo.bg/pe202410/${rik}.html#${sectionCode}`,
    };
  }
  if (electionId === 2) {
    return {
      protocol: `https://results.cik.bg/pe202410_ks/rezultati/${rik}.html#/pk/64/${sectionCode}.0.html`,
      scan: `https://results.cik.bg/pe202410_ks/rezultati/${rik}.html#/s/64/${sectionCode}.0.pdf`,
      video: `https://evideo.bg/pe202410/${rik}.html#${sectionCode}`,
    };
  }
  return null;
}

const BULGARIA_CENTER: [number, number] = [25.5, 42.7];
const BULGARIA_ZOOM = 7;

const BASE_SOURCE = "all-sections";
const BASE_LAYER = "all-sections-circles";
const CIRCLE_SOURCE = "risk-sections";
const CIRCLE_LAYER = "risk-circles";
const CIRCLE_HOVER_LAYER = "risk-circles-hover";
const MUNI_SOURCE = "municipality-boundaries";
const MUNI_BORDER_LAYER = "municipality-borders";

// Offset overlapping sections so they don't stack on the same point.
// Uses a sunflower spiral: golden-angle spacing with increasing radius.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5°
const OFFSET_RADIUS = 0.00018; // ~20m at Bulgarian latitudes

function offsetOverlappingSections<T extends { lat: number | null; lng: number | null }>(
  sections: T[],
): (T & { _lng: number; _lat: number })[] {
  // Group by coordinate key
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

function getRiskValue(s: RiskSection, methodology: Methodology): number {
  switch (methodology) {
    case "benford": return s.benford_risk ?? 0;
    case "peer": return s.peer_risk ?? 0;
    case "acf": return s.acf_risk ?? 0;
    default: return s.risk_score ?? 0;
  }
}

function buildCircleFeatures(sections: RiskSection[], methodology: Methodology) {
  const spread = offsetOverlappingSections(sections.filter((s) => s.lat != null && s.lng != null));
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

const TRIANGLE_ICON = "risk-triangle";
const TRIANGLE_SIZE = 48;

function ensureTriangleIcon(map: MapLibreGL.Map) {
  if (map.hasImage(TRIANGLE_ICON)) return;
  const size = TRIANGLE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Draw upward-pointing triangle (warning sign shape)
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

// Risk layer using triangle symbol markers
function CircleLayer({
  sections,
  methodology,
}: {
  sections: RiskSection[];
  methodology: Methodology;
}) {
  const { map, isLoaded } = useMap();
  const hoveredIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !isLoaded || sections.length === 0) return;

    ensureTriangleIcon(map);
    const fc = buildCircleFeatures(sections, methodology);

    const existing = map.getSource(CIRCLE_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(fc as any);
    } else {
      map.addSource(CIRCLE_SOURCE, { type: "geojson", data: fc as any });
    }

    if (!map.getLayer(CIRCLE_LAYER)) {
      map.addLayer({
        id: CIRCLE_LAYER,
        type: "symbol",
        source: CIRCLE_SOURCE,
        layout: {
          "icon-image": TRIANGLE_ICON,
          "icon-size": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, 0.35,
            0.5, 0.55,
            0.7, 0.75,
            1.0, 1.0,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, "#facc15",  // yellow
            0.5, "#f97316",  // orange
            0.7, "#ef4444",  // red
            1.0, "#991b1b",  // dark red
          ],
          "icon-opacity": 0.9,
        },
      });
    }

    // Hover enlargement layer (invisible by default, shown on hover)
    if (!map.getLayer(CIRCLE_HOVER_LAYER)) {
      map.addLayer({
        id: CIRCLE_HOVER_LAYER,
        type: "symbol",
        source: CIRCLE_SOURCE,
        layout: {
          "icon-image": TRIANGLE_ICON,
          "icon-size": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, 0.5,
            0.5, 0.7,
            0.7, 0.9,
            1.0, 1.3,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, "#facc15",
            0.5, "#f97316",
            0.7, "#ef4444",
            1.0, "#991b1b",
          ],
          "icon-opacity": 1.0,
        },
        filter: ["==", "section_code", ""],
      });
    }

    return () => {
      try {
        if (map.getLayer(CIRCLE_HOVER_LAYER)) map.removeLayer(CIRCLE_HOVER_LAYER);
        if (map.getLayer(CIRCLE_LAYER)) map.removeLayer(CIRCLE_LAYER);
        if (map.getSource(CIRCLE_SOURCE)) map.removeSource(CIRCLE_SOURCE);
      } catch { /* map already destroyed */ }
    };
  }, [map, isLoaded, sections, methodology]);

  // Hover + cursor
  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleMouseMove = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CIRCLE_LAYER] });
      if (features.length > 0) {
        map.getCanvas().style.cursor = "pointer";
        const code = features[0].properties?.section_code;
        if (code !== hoveredIdRef.current) {
          hoveredIdRef.current = code;
          map.setFilter(CIRCLE_HOVER_LAYER, ["==", "section_code", code]);
        }
      } else {
        map.getCanvas().style.cursor = "";
        if (hoveredIdRef.current) {
          hoveredIdRef.current = null;
          map.setFilter(CIRCLE_HOVER_LAYER, ["==", "section_code", ""]);
        }
      }
    };

    map.on("mousemove", handleMouseMove);
    return () => {
      map.off("mousemove", handleMouseMove);
    };
  }, [map, isLoaded]);

  return null;
}

// Municipality boundary outlines for context
function MunicipalityOutlines({ electionId }: { electionId: string }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded || !electionId) return;

    fetch(`/api/elections/${electionId}/results/geo`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data?.municipalities) return;
        const fc = {
          type: "FeatureCollection",
          features: data.municipalities.map((m: any) => ({
            type: "Feature",
            geometry: m.geo,
            properties: { name: m.name },
          })),
        };

        const existing = map.getSource(MUNI_SOURCE);
        if (existing) {
          (existing as MapLibreGL.GeoJSONSource).setData(fc as any);
        } else {
          map.addSource(MUNI_SOURCE, { type: "geojson", data: fc as any });
        }

        if (!map.getLayer(MUNI_BORDER_LAYER)) {
          // Add before circle layers so circles render on top
          map.addLayer({
            id: MUNI_BORDER_LAYER,
            type: "line",
            source: MUNI_SOURCE,
            paint: {
              "line-color": "rgba(100,100,100,0.25)",
              "line-width": 0.8,
            },
          });
        }
      })
      .catch(() => {});

    return () => {
      try {
        if (map.getLayer(MUNI_BORDER_LAYER)) map.removeLayer(MUNI_BORDER_LAYER);
        if (map.getSource(MUNI_SOURCE)) map.removeSource(MUNI_SOURCE);
      } catch { /* map already destroyed */ }
    };
  }, [map, isLoaded, electionId]);

  return null;
}

// Click handler component — dispatches to parent via callback
function CircleClickHandler({
  onSectionClick,
}: {
  onSectionClick: (sectionCode: string) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onSectionClick);
  onClickRef.current = onSectionClick;

  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CIRCLE_LAYER] });
      if (!features.length) return;
      const code = features[0].properties?.section_code;
      if (code) onClickRef.current(code);
    };

    map.on("click", CIRCLE_LAYER, handleClick);
    return () => {
      map.off("click", CIRCLE_LAYER, handleClick);
    };
  }, [map, isLoaded]);

  return null;
}

// Base layer: all sections colored by winner party
function AllSectionsLayer({
  sections,
  onSectionClick,
  riskCodes,
}: {
  sections: SectionGeo[];
  onSectionClick: (sectionCode: string) => void;
  riskCodes?: Set<string>;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onSectionClick);
  onClickRef.current = onSectionClick;

  useEffect(() => {
    if (!map || !isLoaded || sections.length === 0) return;

    const baseSections = riskCodes?.size
      ? sections.filter((s) => !riskCodes.has(s.section_code))
      : sections;
    const spread = offsetOverlappingSections(baseSections);
    const fc = {
      type: "FeatureCollection" as const,
      features: spread.map((s) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s._lng, s._lat] },
        properties: {
          section_code: s.section_code,
          winner_color: s.winner_color,
        },
      })),
    };

    const existing = map.getSource(BASE_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(fc as any);
    } else {
      map.addSource(BASE_SOURCE, { type: "geojson", data: fc as any });
    }

    if (!map.getLayer(BASE_LAYER)) {
      map.addLayer({
        id: BASE_LAYER,
        type: "circle",
        source: BASE_SOURCE,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 2,
            9, 4,
            12, 7,
            15, 12,
          ],
          "circle-color": ["get", "winner_color"],
          "circle-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.5,
            9, 0.7,
            12, 0.85,
          ],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.5)",
        },
      });
    }

    // Click handler for base layer (only fires if risk layer didn't catch it)
    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      // Skip if risk layer already handled this click
      const riskFeatures = map.queryRenderedFeatures(e.point, { layers: map.getLayer(CIRCLE_LAYER) ? [CIRCLE_LAYER] : [] });
      if (riskFeatures.length > 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: [BASE_LAYER] });
      if (!features.length) return;
      const code = features[0].properties?.section_code;
      if (code) onClickRef.current(code);
    };

    const handleMouseMove = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [BASE_LAYER] });
      map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    };

    map.on("click", BASE_LAYER, handleClick);
    map.on("mousemove", handleMouseMove);

    return () => {
      map.off("click", BASE_LAYER, handleClick);
      map.off("mousemove", handleMouseMove);
      try {
        if (map.getLayer(BASE_LAYER)) map.removeLayer(BASE_LAYER);
        if (map.getSource(BASE_SOURCE)) map.removeSource(BASE_SOURCE);
      } catch { /* map already destroyed */ }
    };
  }, [map, isLoaded, sections, riskCodes]);

  return null;
}

// Sidebar for non-risk sections — fetch risk scores and show same detail
function SimpleSidebarContent({ section, electionId }: { section: SectionGeo; electionId: string }) {
  const [riskData, setRiskData] = useState<RiskSection | null>(null);

  useEffect(() => {
    // Try to fetch anomaly data for this section (even if not flagged as risky)
    fetch(`/api/elections/${electionId}/anomalies?min_risk=0&limit=1&section=${section.section_code}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.sections?.length > 0) {
          setRiskData(data.sections[0]);
        }
      })
      .catch(() => {});
  }, [electionId, section.section_code]);

  // Hook must be called unconditionally (before any early return)
  const { data: sectionDetail, loading: detailLoading } = useSectionDetail(electionId, section.section_code);

  // If we got risk data, show the full risk sidebar
  if (riskData) {
    return <RiskSidebarContent section={riskData} electionId={electionId} />;
  }

  // Fallback: show basic results while loading or if no score data exists
  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-bold">{section.section_code}</div>
        <div className="text-sm text-muted-foreground">{section.settlement_name}</div>
      </div>

      <SectionResults data={sectionDetail} loading={detailLoading} electionId={electionId} sectionCode={section.section_code} />
    </div>
  );
}

// Shared UI pieces
function RiskBar({ value, className }: { value: number; className?: string }) {
  const color = value >= 0.6 ? "bg-red-500" : value >= 0.3 ? "bg-orange-400" : "bg-green-500";
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value * 100, 100)}%` }} />
    </div>
  );
}

function FormulaRow({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

function MethodologyCard({
  title,
  score,
  children,
  show = true,
}: {
  title: string;
  score: number;
  children: React.ReactNode;
  show?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!show) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{title}</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground">{score.toFixed(2)}</span>
          </div>
          <RiskBar value={score} className="mt-1.5" />
        </div>
        <span className="text-[10px] text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

interface SectionProtocol {
  registered_voters: number;
  actual_voters: number;
  received_ballots: number;
  added_voters: number;
  invalid_votes: number;
  null_votes: number;
  valid_votes: number;
  machine_count: number;
}

interface SectionParty {
  name: string;
  short_name: string;
  color: string;
  votes: number;
  paper: number;
  machine: number;
  pct: number;
}

interface SectionContext {
  municipality_name: string | null;
  rik_avg_turnout: number | null;
  ekatte_avg_turnout: number | null;
  ekatte_peer_count: number | null;
  municipality_avg_turnout: number | null;
  municipality_turnout_q3: number | null;
  prev_election: { id: number; name: string; date: string } | null;
  prev_turnout: number | null;
}

interface SectionDetail {
  protocol: SectionProtocol;
  parties: SectionParty[];
  context: SectionContext;
}

function useSectionDetail(electionId: string, sectionCode: string) {
  const [data, setData] = useState<SectionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/elections/${electionId}/sections/${sectionCode}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [electionId, sectionCode]);

  return { data, loading };
}

function SectionResults({ data, loading, electionId, sectionCode }: { data: SectionDetail | null; loading: boolean; electionId: string; sectionCode: string }) {
  if (loading) return <div className="text-xs text-muted-foreground">Зареждане на резултати...</div>;
  if (!data) return null;

  const { protocol: p, parties } = data;
  const maxVotes = parties[0]?.votes ?? 1;
  const links = buildProtocolLinks(sectionCode, parseInt(electionId));

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Резултати от гласуването</div>

      {/* Protocol summary */}
      <div className="mb-3 space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Регистрирани</span>
          <span className="font-mono font-medium tabular-nums">{p.registered_voters?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Вписани допълнително</span>
          <span className="font-mono font-medium tabular-nums">{p.added_voters?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Гласували</span>
          <span className="font-mono font-medium tabular-nums">{p.actual_voters?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Активност</span>
          <span className="font-mono font-semibold tabular-nums">
            {p.registered_voters ? pct2((p.actual_voters / p.registered_voters) * 100) : "—"}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Валидни</span>
          <span className="font-mono font-medium tabular-nums text-green-700">{p.valid_votes?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Невалидни</span>
          <span className="font-mono font-medium tabular-nums text-red-600">{(p.invalid_votes + (p.null_votes ?? 0))?.toLocaleString()}</span>
        </div>
        {/* Machine info */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Машинно гласуване</span>
          <span className="font-mono font-medium tabular-nums">
            {p.machine_count > 0 ? `Да (${p.machine_count})` : "Не"}
          </span>
        </div>
      </div>

      {/* CIK protocol links */}
      {links && (
        <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
          <a href={links.protocol} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Протокол</a>
          <a href={links.scan} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Сканиран</a>
          <a href={links.video} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Видео</a>
        </div>
      )}

      {/* Party results */}
      <div className="space-y-2">
        {parties.map((party) => (
          <div key={party.name}>
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span
                  className="size-2.5 flex-shrink-0 rounded-sm"
                  style={{ background: party.color || "#888" }}
                />
                <span className="truncate text-[11px]" title={party.name}>
                  {party.short_name}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[11px] font-mono font-semibold tabular-nums">{pct2(party.pct)}%</span>
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{party.votes.toLocaleString()}</span>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(party.votes / maxVotes) * 100}%`,
                  background: party.color || "#888",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Benford's Law expected distribution for first digits 1-9
const BENFORD_EXPECTED = [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];

function BenfordDetail({ section: s, parties }: { section: RiskSection; parties: SectionParty[] | null }) {
  // Build per-party first-digit data
  const partyDigits: { name: string; votes: number; digit: number }[] = [];
  const digitCounts = new Array(9).fill(0);
  if (parties) {
    for (const p of parties) {
      if (p.votes > 0) {
        const digit = parseInt(String(p.votes)[0], 10);
        if (digit >= 1 && digit <= 9) {
          partyDigits.push({ name: p.short_name, votes: p.votes, digit });
          digitCounts[digit - 1]++;
        }
      }
    }
  }
  const totalDigits = partyDigits.length;
  const observed = totalDigits > 0 ? digitCounts.map((c) => c / totalDigits) : null;

  return (
    <>
      {/* Step 1: What is Benford */}
      <div className="mb-3 text-xs text-muted-foreground">
        Вземаме броя гласове на всяка партия и гледаме с коя цифра започва. По закона на Бенфорд,
        в естествени данни цифрата „1" се среща първа в ~30% от случаите, „2" в ~18%, „3" в ~12%, и т.н.
        Ако някоя секция се отклонява силно, може да е знак за нередност.
      </div>

      {/* Step 2: Show the actual party votes and their first digits */}
      {partyDigits.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
            Гласове по партии → първа цифра
          </div>
          <div className="space-y-0.5">
            {partyDigits.map((pd, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className="flex-1 truncate text-muted-foreground" title={pd.name}>{pd.name}</span>
                <span className="font-mono tabular-nums w-10 text-right">{pd.votes}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono font-semibold w-3 text-center">{pd.digit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Digit distribution comparison */}
      {observed && (
        <div className="mb-3">
          <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
            Колко пъти се среща всяка първа цифра — реално vs по Бенфорд
          </div>
          {/* Visual bar comparison */}
          <div className="space-y-1">
            {observed.map((o, i) => {
              const expected = BENFORD_EXPECTED[i];
              const maxVal = Math.max(o, expected, 0.35);
              const diff = Math.abs(o - expected);
              const barColor = diff > 0.15 ? "#ef4444" : diff > 0.08 ? "#f97316" : "#22c55e";
              return (
                <div key={i}>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="w-3 font-mono font-medium text-right">{i + 1}</span>
                    <div className="flex-1 relative h-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm bg-muted-foreground/15"
                        style={{ width: `${(expected / maxVal) * 100}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{ width: `${(o / maxVal) * 100}%`, background: barColor, opacity: 0.7 }}
                      />
                    </div>
                    <span className="w-16 text-right text-[9px] font-mono tabular-nums text-muted-foreground">
                      {digitCounts[i]}/{totalDigits} = {(o * 100).toFixed(0)}%
                    </span>
                  </div>
                  {digitCounts[i] > 0 && diff > 0.08 && (
                    <div className="ml-4 text-[9px] text-muted-foreground/70">
                      очаквано {(expected * 100).toFixed(0)}%, реално {(o * 100).toFixed(0)}%
                      {diff > 0.15 ? " — силно отклонение" : " — леко отклонение"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-muted-foreground/15" /> По Бенфорд</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-green-500/70" /> Тази секция</span>
          </div>
        </div>
      )}

      {/* Step 4: Statistical test result */}
      <div className="space-y-0.5">
        <FormulaRow label="χ² статистика" value={s.benford_chi2 ?? 0} />
        <FormulaRow label="p-стойност" value={s.benford_p ?? 1} />
      </div>

      {(s.benford_p ?? 1) <= 0.05 ? (
        <div className="mt-2 text-[11px] text-red-700">
          p = {(s.benford_p ?? 1).toFixed(3)} ≤ 0.05 — разпределението е статистически значимо различно от Бенфорд
        </div>
      ) : (s.benford_chi2 ?? 0) > 0 ? (
        <div className="mt-2 text-[11px] text-green-700">
          p = {(s.benford_p ?? 1).toFixed(3)} {">"} 0.05 — отклонението не е статистически значимо
        </div>
      ) : null}

      {totalDigits < 10 && totalDigits > 0 && (
        <div className="mt-1 text-[10px] text-orange-600">
          Само {totalDigits} партии с гласове — малка извадка, тестът е по-ненадежден
        </div>
      )}

      <div className="mt-2 rounded bg-muted/50 p-1.5">
        <div className="text-[10px] font-mono text-muted-foreground">
          benford_score = {s.benford_score.toFixed(2)} (нормализиран 0–1 чрез IQR)
        </div>
      </div>
    </>
  );
}

// Risk explanation sidebar content — full formula breakdown
export function RiskSidebarContent({ section, electionId }: { section: RiskSection; electionId: string }) {
  const [showCorrection, setShowCorrection] = useState(false);
  const s = section;
  const turnoutPct = pct2(s.turnout_rate * 100);
  const risk = s.risk_score;
  const { data: sectionDetail, loading: detailLoading } = useSectionDetail(electionId, s.section_code);
  const ctx = sectionDetail?.context ?? null;

  const riskLabel = risk >= 0.6
    ? "Висок риск — силно отклонение от нормалното"
    : risk >= 0.3
    ? "Среден риск — заслужава проверка"
    : "Нисък риск";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="text-lg font-bold">{s.section_code}</div>
        <div className="text-sm text-muted-foreground">{s.settlement_name}</div>
        {s.address && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{s.address}</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.address}, ${s.settlement_name}, Bulgaria`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-blue-600 hover:underline"
              title="Виж в Google Maps"
            >
              🗺
            </a>
          </div>
        )}
      </div>

      {/* Section results */}
      <SectionResults data={sectionDetail} loading={detailLoading} electionId={electionId} sectionCode={s.section_code} />

      {/* Overall risk */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Комбиниран риск</span>
          <span className="text-sm font-bold font-mono tabular-nums">{risk.toFixed(2)}</span>
        </div>
        <RiskBar value={risk} className="mb-2" />
        <div className="text-xs font-medium">{riskLabel}</div>
        <div className="mt-2 rounded bg-muted/50 p-2">
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">Формула</div>
          <div className="text-[11px] font-mono leading-relaxed">
            риск = (аритм. грешка + несъответствие + активност_норм + бенфорд + активност_населено_норм + партийно_отклонение_норм) / 6
          </div>
          <div className="mt-1.5 space-y-0.5">
            <FormulaRow label="Аритметична грешка в протокола" value={s.arithmetic_error} />
            <FormulaRow label="Несъответствие хартия+машина≠общо" value={s.vote_sum_mismatch} />
            <FormulaRow label="Активност спрямо МИР (норм.)" value={s.turnout_zscore} />
            <FormulaRow label="Отклонение по Бенфорд" value={s.benford_score} />
            <FormulaRow label="Активност спрямо нас. място (норм.)" value={s.ekatte_turnout_zscore_norm} />
            <FormulaRow label="Партийно отклонение от съседи (норм.)" value={s.peer_vote_deviation_norm} />
          </div>
        </div>
      </div>

      {/* Turnout */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Избирателна активност</div>
        <div className="text-xl font-bold">{turnoutPct}%</div>
        {s.turnout_rate > 1 && (
          <div className="mt-1 text-xs font-medium text-red-600">
            Повече гласували от регистрирани — възможна грешка в данните или допълнително вписани
          </div>
        )}

        {/* Comparison table */}
        {ctx && (
          <div className="mt-2 space-y-0.5 text-[11px]">
            <div className="mb-1 text-[10px] font-medium text-muted-foreground">Сравнение</div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Тази секция</span>
              <span className="font-mono font-semibold tabular-nums">{turnoutPct}%</span>
            </div>
            {ctx.rik_avg_turnout != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Средно за МИР</span>
                <span className="font-mono tabular-nums">{pct2(ctx.rik_avg_turnout * 100)}%</span>
              </div>
            )}
            {ctx.ekatte_avg_turnout != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Средно за {s.settlement_name} ({ctx.ekatte_peer_count} секции)</span>
                <span className="font-mono tabular-nums">{pct2(ctx.ekatte_avg_turnout * 100)}%</span>
              </div>
            )}
            {ctx.municipality_avg_turnout != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Средно за общ. {ctx.municipality_name}</span>
                <span className="font-mono tabular-nums">{pct2(ctx.municipality_avg_turnout * 100)}%</span>
              </div>
            )}
            {ctx.prev_election && ctx.prev_turnout != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground truncate" title={ctx.prev_election.name}>Предишни ({ctx.prev_election.name})</span>
                <span className="font-mono tabular-nums">{pct2(ctx.prev_turnout * 100)}%</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 space-y-0.5">
          <FormulaRow label="Z-score спрямо МИР" value={s.turnout_zscore} />
          <FormulaRow label="Z-score спрямо населено място" value={s.ekatte_turnout_zscore} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {Math.abs(s.ekatte_turnout_zscore) > 3
            ? `Активността (${turnoutPct}%) е драстично различна от съседните секции в ${s.settlement_name} (${ctx?.ekatte_avg_turnout != null ? pct2(ctx.ekatte_avg_turnout * 100) + "%" : "—"})`
            : Math.abs(s.ekatte_turnout_zscore) > 2
            ? `Активността се отличава значително от съседните секции в ${s.settlement_name}`
            : Math.abs(s.ekatte_turnout_zscore) > 1
            ? "Леко отклонение от съседните секции"
            : "Нормална активност спрямо района"}
        </div>
      </div>

      {/* Binary flags */}
      {(s.arithmetic_error || s.vote_sum_mismatch) ? (
        <div className="space-y-1.5">
          {s.arithmetic_error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-medium text-red-800">Аритметична грешка в протокола</div>
              <div className="mt-1 text-[11px] text-red-600">Гласувалите са повече от получените бюлетини</div>
            </div>
          ) : null}
          {s.vote_sum_mismatch ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-medium text-red-800">Несъответствие в сумата на гласовете</div>
              <div className="mt-1 text-[11px] text-red-600">При поне една партия: хартиени + машинни ≠ общо</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* === BENFORD === */}
      <MethodologyCard title="Закон на Бенфорд" score={s.benford_risk}>
        <BenfordDetail section={s} parties={sectionDetail?.parties ?? null} />
      </MethodologyCard>

      {/* === PEER DEVIATION === */}
      <MethodologyCard title="Отклонение от съседни секции" score={s.peer_risk}>
        <div className="mb-2 text-xs text-muted-foreground">
          Секциите в {s.settlement_name} ({ctx?.ekatte_peer_count ?? "?"} секции) би трябвало да имат сходна активност и партийни резултати.
          Рязко различаваща се секция заслужава внимание.
        </div>
        <div className="space-y-0.5">
          <FormulaRow label={`Активност на секцията`} value={pct2(s.turnout_rate * 100)} unit="%" />
          {ctx?.ekatte_avg_turnout != null && (
            <FormulaRow label={`Средно за ${s.settlement_name}`} value={pct2(ctx.ekatte_avg_turnout * 100)} unit="%" />
          )}
          <FormulaRow label="Z-score спрямо нас. място" value={s.ekatte_turnout_zscore} />
          <FormulaRow label="ekatte_zscore_norm" value={s.ekatte_turnout_zscore_norm} />
          <FormulaRow label="Партийно отклонение (χ²)" value={s.peer_vote_deviation} />
          <FormulaRow label="peer_vote_deviation_norm" value={s.peer_vote_deviation_norm} />
        </div>
        <div className="mt-2 rounded bg-muted/50 p-2">
          <div className="text-[10px] font-medium text-muted-foreground">Формула</div>
          <div className="mt-0.5 text-[11px] font-mono">
            peer_risk = (ekatte_zscore_norm + peer_vote_deviation_norm) / 2
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-foreground">
            = ({s.ekatte_turnout_zscore_norm.toFixed(2)} + {s.peer_vote_deviation_norm.toFixed(2)}) / 2 = <span className="font-semibold">{s.peer_risk.toFixed(2)}</span>
          </div>
        </div>
      </MethodologyCard>

      {/* === ACF === */}
      <MethodologyCard title="АКФ модел (контролиран вот)" score={s.acf_risk}>
        <div className="mb-2 text-xs text-muted-foreground">
          Методология на Антикорупционния фонд. Три подмодела — два сравняват с предишни избори,
          един анализира текущите резултати спрямо общ. {ctx?.municipality_name ?? "общината"}.
        </div>

        {/* Sub-model 1: Multi-component */}
        <div className="mb-3 rounded border border-border p-2">
          <div className="mb-1 text-[11px] font-semibold">1. Мулти-компонентен анализ спрямо общ. {ctx?.municipality_name ?? "—"}</div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Секцията е извънредна стойност ако надвишава Q3 + 2.2×IQR на общинско ниво.
            Флагва се само ако е извънредна и по трите критерия едновременно.
          </div>
          <div className="space-y-1">
            <div className="text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Активност</span>
                <span className={`font-mono font-medium ${s.acf_turnout_outlier ? "text-red-600" : "text-green-600"}`}>
                  {s.acf_turnout_outlier ? "извънредна" : "в норма"}
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground/70">
                <span>Секция: {turnoutPct}%</span>
                <span>Средно за общината: {ctx?.municipality_avg_turnout != null ? pct2(ctx.municipality_avg_turnout * 100) + "%" : "—"}</span>
              </div>
            </div>
            <div className="text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">% на победител</span>
                <span className={`font-mono font-medium ${s.acf_winner_outlier ? "text-red-600" : "text-green-600"}`}>
                  {s.acf_winner_outlier ? "извънредна" : "в норма"}
                </span>
              </div>
            </div>
            <div className="text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Невалидни бюлетини</span>
                <span className={`font-mono font-medium ${s.acf_invalid_outlier ? "text-red-600" : "text-green-600"}`}>
                  {s.acf_invalid_outlier ? "извънредна" : "в норма"}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-1.5 rounded bg-muted/50 p-1.5">
            <div className="text-[10px] font-mono text-muted-foreground">
              acf_multicomponent = {s.acf_multicomponent.toFixed(2)}
              {s.acf_multicomponent >= 1
                ? " — извънредна и по трите критерия"
                : s.acf_multicomponent > 0
                ? ` — извънредна по ${Math.round(s.acf_multicomponent * 3)} от 3`
                : " — в норма и по трите"}
            </div>
          </div>
        </div>

        {/* Sub-model 2: Turnout shift */}
        <div className="mb-3 rounded border border-border p-2">
          <div className="mb-1 text-[11px] font-semibold">2. Промяна в активността</div>
          {s.acf_turnout_shift != null && ctx?.prev_election ? (
            <>
              <div className="mb-1 text-[11px] text-muted-foreground">
                Спрямо <span className="font-medium text-foreground">{ctx.prev_election.name}</span>
              </div>
              <div className="space-y-0.5 text-[11px]">
                {ctx.prev_turnout != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Активност тогава</span>
                    <span className="font-mono tabular-nums">{pct2(ctx.prev_turnout * 100)}%</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Активност сега</span>
                  <span className="font-mono tabular-nums">{turnoutPct}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Промяна (минус общ. тренд)</span>
                  <span className="font-mono font-medium tabular-nums">{pct2(s.acf_turnout_shift * 100)} пр.т.</span>
                </div>
              </div>
              <div className="mt-1.5 rounded bg-muted/50 p-1.5">
                <div className="text-[10px] font-mono text-muted-foreground">
                  acf_turnout_shift_norm = {s.acf_turnout_shift_norm.toFixed(2)}
                </div>
              </div>
            </>
          ) : s.acf_turnout_shift != null ? (
            <>
              <div className="space-y-0.5">
                <FormulaRow label="Промяна (минус общ. тренд)" value={s.acf_turnout_shift} />
                <FormulaRow label="acf_turnout_shift_norm" value={s.acf_turnout_shift_norm} />
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground/70">
              Няма предишни избори от същия тип — моделът не е приложим
            </div>
          )}
        </div>

        {/* Sub-model 3: Party shift */}
        <div className="mb-3 rounded border border-border p-2">
          <div className="mb-1 text-[11px] font-semibold">3. Промяна в партийните резултати</div>
          {s.acf_party_shift != null && ctx?.prev_election ? (
            <>
              <div className="mb-1 text-[11px] text-muted-foreground">
                Спрямо <span className="font-medium text-foreground">{ctx.prev_election.name}</span>
              </div>
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Макс. промяна в дял на партия</span>
                  <span className="font-mono font-medium tabular-nums">{pct2(s.acf_party_shift * 100)} пр.т.</span>
                </div>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Промяната е спрямо предишните избори, минус средната промяна в общ. {ctx.municipality_name}
                (за да се изключи национален тренд).
              </div>
              <div className="mt-1.5 rounded bg-muted/50 p-1.5">
                <div className="text-[10px] font-mono text-muted-foreground">
                  acf_party_shift_norm = {s.acf_party_shift_norm.toFixed(2)}
                </div>
              </div>
            </>
          ) : s.acf_party_shift != null ? (
            <>
              <div className="space-y-0.5">
                <FormulaRow label="Макс. промяна (минус общ. тренд)" value={s.acf_party_shift} />
                <FormulaRow label="acf_party_shift_norm" value={s.acf_party_shift_norm} />
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground/70">
              Няма предишни избори от същия тип — моделът не е приложим
            </div>
          )}
        </div>

        {/* ACF composite formula */}
        <div className="rounded bg-muted/50 p-2">
          <div className="text-[10px] font-medium text-muted-foreground">Формула</div>
          {s.acf_turnout_shift != null ? (
            <>
              <div className="mt-0.5 text-[11px] font-mono">
                acf_risk = (multicomponent + turnout_shift_norm + party_shift_norm) / 3
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-foreground">
                = ({s.acf_multicomponent.toFixed(2)} + {s.acf_turnout_shift_norm.toFixed(2)} + {s.acf_party_shift_norm.toFixed(2)}) / 3 = <span className="font-semibold">{s.acf_risk.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-0.5 text-[11px] font-mono">
                acf_risk = acf_multicomponent (няма предишни избори)
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-foreground">
                = <span className="font-semibold">{s.acf_multicomponent.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      </MethodologyCard>

      {/* Location correction */}
      <button
        onClick={() => setShowCorrection(true)}
        className="w-full rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        Грешна локация
      </button>

      {showCorrection && (
        <LocationCorrection
          sectionCode={s.section_code}
          electionId={electionId}
          settlementName={s.settlement_name}
          address={s.address}
          currentLat={s.lat}
          currentLng={s.lng}
          onClose={() => setShowCorrection(false)}
        />
      )}
    </div>
  );
}

export default function RiskMap() {
  const { electionId } = useParams<{ electionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read filter state from URL params
  const methodology = (searchParams.get("m") ?? "combined") as Methodology;
  const minRisk = parseFloat(searchParams.get("risk") ?? "0");
  const district = searchParams.get("district") ?? "";
  const municipality = searchParams.get("municipality") ?? "";
  const selectedCode = searchParams.get("section") ?? "";

  // Helper to update a single search param without losing others
  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  const setMethodology = (m: Methodology) => setParam("m", m === "combined" ? "" : m);
  const setMinRisk = (v: number) => setParam("risk", v === 0 ? "" : String(v));
  const setDistrict = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("district", v);
      else next.delete("district");
      next.delete("municipality");
      return next;
    }, { replace: true });
  };
  const setMunicipality = (v: string) => setParam("municipality", v);
  const sectionFilter = searchParams.get("q") ?? "";
  const setSectionFilter = (v: string) => setParam("q", v);

  // All sections (base layer)
  const [allSections, setAllSections] = useState<SectionGeo[]>([]);
  const [baseLoading, setBaseLoading] = useState(true);

  // Risk sections (overlay)
  const [riskSections, setRiskSections] = useState<RiskSection[]>([]);
  const [total, setTotal] = useState(0);
  const [riskLoading, setRiskLoading] = useState(false);

  const [showBaseSections, setShowBaseSections] = useState(true);
  const [districts, setDistricts] = useState<GeoEntity[]>([]);
  const [municipalities, setMunicipalities] = useState<GeoEntity[]>([]);

  // Fetch all sections (base layer), filtered by location
  useEffect(() => {
    if (!electionId) return;
    setBaseLoading(true);
    const params = new URLSearchParams();
    if (municipality) params.set("municipality", municipality);
    else if (district) params.set("district", district);
    const qs = params.toString();
    fetch(`/api/elections/${electionId}/sections/geo${qs ? `?${qs}` : ""}`)
      .then((res) => res.json())
      .then((data) => setAllSections(data.sections ?? []))
      .catch(() => {})
      .finally(() => setBaseLoading(false));
  }, [electionId, district, municipality]);

  // Fetch districts on mount
  useEffect(() => {
    fetch("/api/geography/districts")
      .then((r) => r.json())
      .then(setDistricts);
  }, []);

  // Fetch municipalities when district changes
  useEffect(() => {
    if (!district) {
      setMunicipalities([]);
      return;
    }
    fetch(`/api/geography/municipalities?district=${district}`)
      .then((r) => r.json())
      .then(setMunicipalities);
  }, [district]);

  // Fetch anomaly sections (only when risk filter is active)
  useEffect(() => {
    if (!electionId || minRisk <= 0) {
      setRiskSections([]);
      setTotal(0);
      return;
    }
    setRiskLoading(true);

    const params = new URLSearchParams();
    params.set("min_risk", String(minRisk));
    params.set("sort", "risk_score");
    params.set("order", "desc");
    params.set("limit", "0");
    if (methodology !== "combined") params.set("methodology", methodology);
    if (municipality) params.set("municipality", municipality);
    else if (district) params.set("district", district);

    fetch(`/api/elections/${electionId}/anomalies?${params}`)
      .then((r) => r.json())
      .then((data: AnomaliesResponse) => {
        setRiskSections(data.sections);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setRiskLoading(false));
  }, [electionId, minRisk, methodology, district, municipality]);

  // Filter sections by section code search
  const filteredAllSections = sectionFilter
    ? allSections.filter((s) => s.section_code.includes(sectionFilter))
    : allSections;

  const riskMap = new globalThis.Map(riskSections.map((s) => [s.section_code, s]));
  const baseMap = new globalThis.Map(filteredAllSections.map((s) => [s.section_code, s]));
  const selectedRiskSection = selectedCode ? riskMap.get(selectedCode) ?? null : null;
  const selectedBaseSection = selectedCode && !selectedRiskSection ? baseMap.get(selectedCode) ?? null : null;

  const handleSectionClick = (code: string) => {
    setParam("section", selectedCode === code ? "" : code);
  };

  const riskActive = minRisk > 0;

  const methodologies: { key: Methodology; label: string }[] = [
    { key: "combined", label: "Комбиниран" },
    { key: "benford", label: "Benford" },
    { key: "peer", label: "Peer" },
    { key: "acf", label: "ACF" },
  ];

  return (
    <div className="relative h-full w-full">
      {/* Map */}
      <Map key={`sections-${electionId}`} center={BULGARIA_CENTER} zoom={BULGARIA_ZOOM} className="h-full w-full" loading={baseLoading}>
        {electionId && <MunicipalityOutlines electionId={electionId} />}
        {/* Base layer: all sections by winner color (hidden when toggled off) */}
        {showBaseSections && filteredAllSections.length > 0 && (
          <AllSectionsLayer
            sections={filteredAllSections}
            onSectionClick={handleSectionClick}
            riskCodes={riskActive ? new Set(riskSections.map((s) => s.section_code)) : undefined}
          />
        )}
        {/* Risk overlay: only when filter is active */}
        {riskActive && riskSections.length > 0 && (
          <>
            <CircleLayer sections={riskSections} methodology={methodology} />
            <CircleClickHandler onSectionClick={handleSectionClick} />
          </>
        )}
      </Map>

      {/* Floating filter panel — top left */}
      <div className="absolute top-3 left-3 z-10 flex min-w-[280px] max-w-[320px] flex-col gap-0 rounded-lg border border-border bg-background/96 shadow-lg backdrop-blur-sm">
        {/* Section 1: Location filter */}
        <div className="flex flex-col gap-2.5 p-3.5 pb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Местоположение</div>

          {/* Geographic filters */}
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="mb-0.5 text-[11px] text-muted-foreground">Област</div>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-1.5 py-1 text-xs"
              >
                <option value="">Всички</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <div className="mb-0.5 text-[11px] text-muted-foreground">Община</div>
              <select
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                disabled={!district}
                className="w-full rounded-md border border-border bg-background px-1.5 py-1 text-xs disabled:opacity-50"
              >
                <option value="">Всички</option>
                {municipalities.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Section code search */}
          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">Секция №</div>
            <input
              type="text"
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              placeholder="напр. 234600001"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Section 2: Risk filter */}
        <div className="flex flex-col gap-2.5 p-3.5 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Рисков анализ</div>

          {/* Risk threshold */}
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              Мин. риск: <span className="font-bold text-foreground">{minRisk.toFixed(2)}</span>
              {!riskActive && <span className="ml-1 text-muted-foreground/60">(изключен)</span>}
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minRisk}
              onChange={(e) => setMinRisk(parseFloat(e.target.value))}
              className="w-full accent-red-500"
            />
          </div>

          {/* Methodology pills — only when risk is active */}
          {riskActive && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Методология</div>
              <div className="flex flex-wrap gap-1">
                {methodologies.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMethodology(m.key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      methodology === m.key
                        ? "bg-foreground text-background"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Show all sections toggle */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBaseSections}
              onChange={(e) => setShowBaseSections(e.target.checked)}
              className="accent-foreground"
            />
            Покажи всички секции
          </label>

          {/* Section count */}
          <div className="rounded-md bg-secondary px-2.5 py-1.5 text-center text-xs text-muted-foreground">
            {baseLoading || riskLoading ? (
              "Зареждане..."
            ) : riskActive ? (
              <>
                <b>{riskSections.filter((s) => s.lat != null).length}</b> рискови
                {showBaseSections && (
                  <> от <b>{filteredAllSections.length.toLocaleString()}</b></>
                )}{" "}
                секции
              </>
            ) : (
              <>
                {sectionFilter ? (
                  <><b>{filteredAllSections.length.toLocaleString()}</b> от {allSections.length.toLocaleString()} секции</>
                ) : (
                  <>{allSections.length.toLocaleString()} секции</>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Legend — bottom left (only when risk overlay is active) */}
      {riskActive && (
        <div className="absolute bottom-4 left-3 z-10 rounded-lg border border-border bg-background/94 p-3 text-[11px] shadow-md backdrop-blur-sm">
          <div className="mb-1.5 font-semibold text-muted-foreground">Ниво на риск</div>
          {[
            { size: "h-2.5 w-2.5", color: "bg-yellow-400", label: "0.3 — Нисък" },
            { size: "h-3 w-3", color: "bg-orange-500", label: "0.5 — Среден" },
            { size: "h-3.5 w-3.5", color: "bg-red-500", label: "0.7 — Висок" },
            { size: "h-4 w-4", color: "bg-red-900", label: "1.0 — Критичен" },
          ].map((item) => (
            <div key={item.label} className="mb-0.5 flex items-center gap-1.5">
              <span className={`inline-block rounded-full ${item.size} ${item.color}`} />
              <span className="text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sidebar — risk detail or simple results */}
      <Sidebar
        open={!!selectedRiskSection || !!selectedBaseSection}
        onClose={() => setParam("section", "")}
        title={selectedRiskSection?.section_code ?? selectedBaseSection?.section_code}
      >
        {selectedRiskSection && (
          <RiskSidebarContent section={selectedRiskSection} electionId={electionId!} />
        )}
        {selectedBaseSection && (
          <SimpleSidebarContent section={selectedBaseSection} electionId={electionId!} />
        )}
      </Sidebar>
    </div>
  );
}
