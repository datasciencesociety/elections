import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map } from "@/components/ui/map";
import Sidebar from "@/components/sidebar.js";
import { useAnomalies } from "@/lib/hooks/use-anomalies.js";
import { useSectionsGeo } from "@/lib/hooks/use-sections.js";
import { SectionView } from "@/components/section/index.js";
import { Filters, useFilters } from "@/components/section-filters.js";
import type { SectionTypeKey } from "@/lib/section-types.js";

import {
  ANOMALY_MIN_RISK,
  BULGARIA_CENTER,
  BULGARIA_ZOOM,
} from "./map/constants.js";
import { AllSectionsLayer } from "./map/all-sections-layer.js";
import { AnomalyCirclesLayer } from "./map/anomaly-circles-layer.js";
import { FitToFilter } from "./map/fit-to-filter.js";
import { MunicipalityOutlines } from "./map/municipality-outlines.js";
import { SectionClickHandler } from "./map/section-click-handler.js";
import { SelectedSectionRing } from "./map/selected-section-ring.js";

/**
 * The anomaly map page — section-level results overlaid with statistical
 * anomaly markers. Filters sit in a shared top-of-page bar (same shape as
 * sections-table and persistence); the map takes the full remaining height.
 *
 * This file is intentionally a thin composition root: URL state, the data
 * hooks, and the layout. Map layers live under `map/`; the section detail
 * sidebar lives in `components/section/`.
 */
export default function AnomalyMap() {
  const { electionId } = useParams<{ electionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- URL state -----

  const { district, municipality, sectionSearch: sectionFilter, sectionTypes, onlyAnomalies, methodology } = useFilters();
  const selectedCode = searchParams.get("section") ?? "";

  const setParam = (key: string, value: string, opts?: { push?: boolean }) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: !opts?.push },
    );
  };

  // ----- Data hooks -----

  const { data: sectionsGeoData, isLoading: baseLoading } = useSectionsGeo(
    electionId,
    {
      district: district || undefined,
      municipality: municipality || undefined,
    },
  );
  const allSections = sectionsGeoData?.sections ?? [];

  const { data: anomaliesData, isFetching: riskLoading } = useAnomalies({
    electionId: electionId!,
    minRisk: ANOMALY_MIN_RISK,
    methodology,
    district: district || undefined,
    municipality: municipality || undefined,
    sort: methodology === "protocol" ? "protocol_violation_count" : "risk_score",
    order: "desc",
    limit: 0,
  });
  const riskSections = anomaliesData?.sections ?? [];

  // ----- Derived state -----

  const filteredAllSections = useMemo(() => {
    const bySection = sectionFilter
      ? allSections.filter((s) => s.section_code.includes(sectionFilter))
      : allSections;
    return bySection.filter((s) =>
      sectionTypes.has((s.section_type as SectionTypeKey) ?? "normal"),
    );
  }, [allSections, sectionFilter, sectionTypes]);

  const filteredRiskSections = useMemo(
    () =>
      riskSections.filter((s) =>
        sectionTypes.has((s.section_type as SectionTypeKey) ?? "normal"),
      ),
    [riskSections, sectionTypes],
  );

  const colorByCode = useMemo(() => {
    const m = new globalThis.Map<string, string>();
    for (const s of allSections) m.set(s.section_code, s.winner_color);
    return m;
  }, [allSections]);

  const riskMap = new globalThis.Map(riskSections.map((s) => [s.section_code, s]));
  const selectedAnomaly = selectedCode ? riskMap.get(selectedCode) ?? null : null;

  const handleSectionClick = (code: string) => {
    if (selectedCode !== code) {
      trackEvent("click_section", { section_code: code, election_id: electionId });
    }
    const opening = !selectedCode && selectedCode !== code;
    setParam("section", selectedCode === code ? "" : code, { push: opening });
  };

  const fitKey = municipality ? `m:${municipality}` : district ? `d:${district}` : "";

  const riskCountWithCoords = filteredRiskSections.filter((s) => s.lat != null).length;

  // ----- Render -----

  return (
    <div className={`flex h-full flex-col overflow-hidden ${selectedCode ? "md:pr-sidebar" : ""}`}>
      <Filters />

      {/* Map fills remaining height. Methodology and only-anomalies are
          filter-bar concerns now; only the live counter still floats on the
          map so users know how much is rendered. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-card px-2 py-1.5 font-mono text-2xs tabular-nums text-muted-foreground shadow-sm">
          {baseLoading || riskLoading ? "…" : (
            <>
              <span className="text-foreground">{riskCountWithCoords.toLocaleString("bg-BG")}</span>
              {!onlyAnomalies && (
                <> / <span className="text-foreground">{filteredAllSections.length.toLocaleString("bg-BG")}</span></>
              )}{" "}
              секции
            </>
          )}
        </div>

        <Map
          key={`sections-${electionId}`}
          center={BULGARIA_CENTER}
          zoom={BULGARIA_ZOOM}
          className="h-full w-full"
          loading={baseLoading}
        >
          {electionId && <MunicipalityOutlines electionId={electionId} />}

          {!onlyAnomalies && filteredAllSections.length > 0 && (
            <AllSectionsLayer
              sections={filteredAllSections}
              onSectionClick={handleSectionClick}
              riskCodes={new Set(filteredRiskSections.map((s) => s.section_code))}
            />
          )}

          {filteredRiskSections.length > 0 && (
            <>
              <AnomalyCirclesLayer
                sections={filteredRiskSections}
                methodology={methodology}
                colorByCode={colorByCode}
              />
              <SectionClickHandler onSectionClick={handleSectionClick} />
            </>
          )}

          <FitToFilter fitKey={fitKey} points={filteredAllSections} />

          <SelectedSectionRing sectionCode={selectedCode || null} />
        </Map>
      </div>

      <Sidebar
        open={!!selectedCode}
        onClose={() => setParam("section", "")}
        title={selectedCode || undefined}
      >
        {selectedCode && electionId && (
          <SectionView
            electionId={electionId}
            sectionCode={selectedCode}
            initialAnomaly={selectedAnomaly}
          />
        )}
      </Sidebar>
    </div>
  );
}
