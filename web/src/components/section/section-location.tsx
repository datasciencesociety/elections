import { useState } from "react";
import LocationCorrection, {
  submitLocationConfirmation,
} from "@/components/location-correction.js";
import { SectionHeader } from "./section-header.js";
import { SectionMap } from "./section-map.js";

/**
 * Identifies WHERE a section is, with everything a contributor or reader
 * might want to do with that location:
 *
 *   - settlement / address / type chip
 *   - mini-map (when coordinates exist)
 *   - inline "is this correct?" feedback: Да confirms the auto-location,
 *     Не opens the correction modal
 *   - when there are no coordinates at all, a single "posoche" action
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
  const [confirmState, setConfirmState] = useState<
    "idle" | "submitting" | "confirmed" | "error"
  >("idle");
  const hasCoords = lat != null && lng != null;

  async function handleConfirm() {
    if (!hasCoords) return;
    setConfirmState("submitting");
    try {
      await submitLocationConfirmation({
        sectionCode,
        electionId,
        settlementName: settlementName ?? "",
        address,
        lat: lat!,
        lng: lng!,
      });
      setConfirmState("confirmed");
    } catch {
      // no-cors swallows errors; the catch is defensive, not expected
      setConfirmState("error");
    }
  }

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

      {hasCoords ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          {confirmState === "confirmed" ? (
            <span className="text-muted-foreground">
              ✓ Благодарим за потвърждението.
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">
                Секцията коректно ли е показана на картата?
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={handleConfirm}
                  disabled={confirmState === "submitting"}
                  className="rounded border border-border px-2.5 py-0.5 font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
                >
                  {confirmState === "submitting" ? "Изпращане..." : "Да"}
                </button>
                <button
                  onClick={() => setShowCorrection(true)}
                  className="rounded border border-[#ce463c] px-2.5 py-0.5 font-medium text-[#ce463c] transition-colors hover:bg-[#ce463c] hover:text-white"
                >
                  Не
                </button>
              </div>
              {confirmState === "error" && (
                <span className="w-full text-[10px] text-[#ce463c]">
                  Грешка при изпращане. Опитайте отново.
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowCorrection(true)}
          className="w-full rounded-md border border-[#ce463c] px-3 py-1.5 text-[11px] font-medium text-[#ce463c] transition-colors hover:bg-[#ce463c] hover:text-white"
        >
          Посочете секцията на картата →
        </button>
      )}

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
