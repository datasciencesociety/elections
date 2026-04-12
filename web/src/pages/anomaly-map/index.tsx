import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map } from "@/components/ui/map";
import Sidebar from "@/components/sidebar.js";
import type { AnomalyMethodology } from "@/lib/api/types.js";
import { useAnomalies } from "@/lib/hooks/use-anomalies.js";
import { useDistricts, useMunicipalities } from "@/lib/hooks/use-geography.js";
import { useSectionsGeo } from "@/lib/hooks/use-sections.js";
import { SectionView } from "@/components/section/index.js";

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

import { FilterPanel, type SectionTypeKey } from "./filter-panel.js";

const ALL_SECTION_TYPES: SectionTypeKey[] = [
  "normal",
  "hospital",
  "prison",
  "mobile",
  "abroad",
];
const DEFAULT_SECTION_TYPES = new Set<SectionTypeKey>(ALL_SECTION_TYPES);

/**
 * The anomaly map page — section-level results overlaid with statistical
 * anomaly markers, filterable by district / municipality / methodology.
 *
 * This file is intentionally a thin composition root: URL state, the data
 * hooks, and the layout. The substantive UI lives in:
 *   - `map/`     — every MapLibre layer is its own file
 *   - `sidebar/` — every sidebar card is its own file under `cards/`
 *   - `filter-panel.tsx` — the floating UI
 *
 * Add a new map layer? Drop a file under `map/` and render it inside the
 * `<Map>` block below. Add a new sidebar card? Drop a file under
 * `sidebar/cards/` and add it to `sidebar/index.tsx`.
 */
export default function AnomalyMap() {
  const { electionId } = useParams<{ electionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- URL state -----

  const methodology = (searchParams.get("m") ?? "protocol") as AnomalyMethodology;
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
    setParam("m", m === "protocol" ? "" : m);
  };
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

  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [sectionTypes, setSectionTypes] = useState<Set<SectionTypeKey>>(
    () => new Set(DEFAULT_SECTION_TYPES),
  );
  const toggleSectionType = useCallback((key: SectionTypeKey) => {
    setSectionTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

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

  // Every anomaly triangle inherits the winner's party colour from the base
  // section layer. We build the lookup once per allSections change instead of
  // re-walking the array inside the MapLibre source effect.
  const colorByCode = useMemo(() => {
    const m = new globalThis.Map<string, string>();
    for (const s of allSections) m.set(s.section_code, s.winner_color);
    return m;
  }, [allSections]);

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

  // Trigger key for the fit-to-bounds effect: empty string → Bulgaria default,
  // otherwise the current district/municipality combo.
  const fitKey = municipality
    ? `m:${municipality}`
    : district
      ? `d:${district}`
      : "";

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

      <FilterPanel
        district={district}
        municipality={municipality}
        sectionFilter={sectionFilter}
        methodology={methodology}
        onlyAnomalies={onlyAnomalies}
        sectionTypes={sectionTypes}
        setDistrict={setDistrict}
        setMunicipality={setMunicipality}
        setSectionFilter={setSectionFilter}
        setMethodology={setMethodology}
        setOnlyAnomalies={setOnlyAnomalies}
        toggleSectionType={toggleSectionType}
        districts={districts}
        municipalities={municipalities}
        baseLoading={baseLoading}
        riskLoading={riskLoading}
        baseCount={allSections.length}
        filteredBaseCount={filteredAllSections.length}
        riskCountWithCoords={
          filteredRiskSections.filter((s) => s.lat != null).length
        }
      />

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
