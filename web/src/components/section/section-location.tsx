import { useState } from "react";
import LocationCorrection from "@/components/location-correction.js";
import { SectionHeader } from "./section-header.js";
import { SectionMap } from "./section-map.js";

/**
 * Identifies WHERE a section is, with everything a contributor or reader
 * might want to do with that location:
 *
 *   - settlement / address / type chip
 *   - mini-map (when coordinates exist)
 *   - "wrong location" trigger that opens the correction modal
 *
 * Reused by every surface that shows a section. The same block renders in
 * the anomaly sidebar, the section-detail page, and the persistence
 * popover so the user always has the same affordances.
 *
 * Takes a flat props bag instead of a section object so the caller can
 * feed it from `AnomalySection`, `SectionGeo`, or anywhere else that has
 * the four fields.
 */
export function SectionLocation({
  electionId,
  sectionCode,
  settlementName,
  address,
  sectionType,
  lat,
  lng,
}: {
  electionId: string | number;
  sectionCode: string;
  settlementName: string | null;
  address: string | null;
  sectionType?: string | null;
  lat: number | null;
  lng: number | null;
}) {
  const [showCorrection, setShowCorrection] = useState(false);
  const hasCoords = lat != null && lng != null;

  return (
    <div className="space-y-3">
      <SectionHeader
        settlementName={settlementName}
        address={address}
        sectionType={sectionType}
      />

      {hasCoords ? (
        <SectionMap lat={lat} lng={lng} />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-[11px] text-muted-foreground">
          Няма координати
        </div>
      )}

      <button
        onClick={() => setShowCorrection(true)}
        className="w-full rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        Грешна локация — посочи правилната
      </button>

      {showCorrection && (
        <LocationCorrection
          sectionCode={sectionCode}
          electionId={String(electionId)}
          settlementName={settlementName ?? ""}
          address={address}
          currentLat={lat}
          currentLng={lng}
          onClose={() => setShowCorrection(false)}
        />
      )}
    </div>
  );
}
