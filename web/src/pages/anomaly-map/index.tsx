import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map } from "@/components/ui/map";
import Sidebar from "@/components/sidebar.js";
import type { AnomalyMethodology } from "@/lib/api/types.js";
import { useAnomalies } from "@/lib/hooks/use-anomalies.js";
import { useDistricts, useMunicipalities } from "@/lib/hooks/use-geography.js";
import { useSectionsGeo } from "@/lib/hooks/use-sections.js";
import { SectionView } from "@/components/section/index.js";

import { BULGARIA_CENTER, BULGARIA_ZOOM } from "./map/constants.js";
import { AllSectionsLayer } from "./map/all-sections-layer.js";
import { AnomalyCirclesLayer } from "./map/anomaly-circles-layer.js";
import { MunicipalityOutlines } from "./map/municipality-outlines.js";
import { SectionClickHandler } from "./map/section-click-handler.js";
import { SelectedSectionRing } from "./map/selected-section-ring.js";

import { FilterPanel } from "./filter-panel.js";
import { AnomalyLegend } from "./anomaly-legend.js";

/**
 * The anomaly map page — section-level results overlaid with statistical
 * anomaly markers, filterable by district / municipality / score / methodology.
 *
 * This file is intentionally a thin composition root: URL state, the data
 * hooks, and the layout. The substantive UI lives in:
 *   - `map/`     — every MapLibre layer is its own file
 *   - `sidebar/` — every sidebar card is its own file under `cards/`
 *   - `filter-panel.tsx` and `anomaly-legend.tsx` — the floating UI
 *
 * Add a new map layer? Drop a file under `map/` and render it inside the
 * `<Map>` block below. Add a new sidebar card? Drop a file under
 * `sidebar/cards/` and add it to `sidebar/index.tsx`.
 */
export default function AnomalyMap() {
  const { electionId } = useParams<{ electionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- URL state -----

  const methodology = (searchParams.get("m") ?? "combined") as AnomalyMethodology;
  const minRisk = parseFloat(searchParams.get("risk") ?? "0");
  const district = searchParams.get("district") ?? "";
  const municipality = searchParams.get("municipality") ?? "";
  const sectionFilter = searchParams.get("q") ?? "";
  const selectedCode = searchParams.get("section") ?? "";

  const setParam = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const setMethodology = (m: AnomalyMethodology) => {
    trackEvent("filter_methodology", {
      methodology: m,
      election_id: electionId,
    });
    setParam("m", m === "combined" ? "" : m);
  };
  const setMinRisk = (v: number) => setParam("risk", v === 0 ? "" : String(v));
  const setDistrict = (v: string) => {
    if (v) trackEvent("filter_district", { district: v, election_id: electionId });
    // Clearing district also clears municipality so the dropdowns stay coherent.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set("district", v);
        else next.delete("district");
        next.delete("municipality");
        return next;
      },
      { replace: true },
    );
  };
  const setMunicipality = (v: string) => {
    if (v)
      trackEvent("filter_municipality", {
        municipality: v,
        election_id: electionId,
      });
    setParam("municipality", v);
  };
  const setSectionFilter = (v: string) => setParam("q", v);

  // ----- Local UI state (not URL-bound) -----

  const [showBaseSections, setShowBaseSections] = useState(true);

  // ----- Data hooks -----

  const { data: districts = [] } = useDistricts();
  const { data: municipalities = [] } = useMunicipalities(district || undefined);

  const { data: sectionsGeoData, isLoading: baseLoading } = useSectionsGeo(
    electionId,
    {
      district: district || undefined,
      municipality: municipality || undefined,
    },
  );
  const allSections = sectionsGeoData?.sections ?? [];

  const riskActive = minRisk > 0;
  const { data: anomaliesData, isFetching: riskLoading } = useAnomalies(
    {
      electionId: electionId!,
      minRisk,
      methodology,
      district: district || undefined,
      municipality: municipality || undefined,
      sort: methodology === "protocol" ? "protocol_violation_count" : "risk_score",
      order: "desc",
      limit: 0,
    },
    riskActive,
  );
  const riskSections = anomaliesData?.sections ?? [];

  // ----- Derived state -----

  const filteredAllSections = sectionFilter
    ? allSections.filter((s) => s.section_code.includes(sectionFilter))
    : allSections;

  // The selected section gets fetched fresh by `<SectionView>` regardless of
  // which layer it came from, but if we already have the anomaly row in the
  // current overlay we pass it as `initialAnomaly` to skip the extra fetch.
  const riskMap = new globalThis.Map(riskSections.map((s) => [s.section_code, s]));
  const selectedAnomaly = selectedCode ? riskMap.get(selectedCode) ?? null : null;

  const handleSectionClick = (code: string) => {
    if (selectedCode !== code) {
      trackEvent("click_section", {
        section_code: code,
        election_id: electionId,
      });
    }
    setParam("section", selectedCode === code ? "" : code);
  };

  // ----- Render -----

  return (
    <div className="relative h-full w-full">
      <Map
        key={`sections-${electionId}`}
        center={BULGARIA_CENTER}
        zoom={BULGARIA_ZOOM}
        className="h-full w-full"
        loading={baseLoading}
      >
        {electionId && <MunicipalityOutlines electionId={electionId} />}

        {showBaseSections && filteredAllSections.length > 0 && (
          <AllSectionsLayer
            sections={filteredAllSections}
            onSectionClick={handleSectionClick}
            riskCodes={
              riskActive
                ? new Set(riskSections.map((s) => s.section_code))
                : undefined
            }
          />
        )}

        {riskActive && riskSections.length > 0 && (
          <>
            <AnomalyCirclesLayer
              sections={riskSections}
              methodology={methodology}
            />
            <SectionClickHandler onSectionClick={handleSectionClick} />
          </>
        )}

        <SelectedSectionRing sectionCode={selectedCode || null} />
      </Map>

      <FilterPanel
        district={district}
        municipality={municipality}
        sectionFilter={sectionFilter}
        minRisk={minRisk}
        methodology={methodology}
        showBaseSections={showBaseSections}
        setDistrict={setDistrict}
        setMunicipality={setMunicipality}
        setSectionFilter={setSectionFilter}
        setMinRisk={setMinRisk}
        setMethodology={setMethodology}
        setShowBaseSections={setShowBaseSections}
        districts={districts}
        municipalities={municipalities}
        baseLoading={baseLoading}
        riskLoading={riskLoading}
        riskActive={riskActive}
        baseCount={allSections.length}
        filteredBaseCount={filteredAllSections.length}
        riskCountWithCoords={riskSections.filter((s) => s.lat != null).length}
      />

      {riskActive && <AnomalyLegend />}

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
