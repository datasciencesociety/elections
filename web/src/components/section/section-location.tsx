import { useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import LocationCorrection, {
  submitLocationConfirmation,
} from "@/components/location-correction.js";
import { SectionMap } from "./section-map.js";

/**
 * Identifies WHERE a section is, with everything a contributor or reader
 * might want to do with that location:
 *
 *   - settlement / address / type chip
 *   - mini-map (when coordinates exist)
 *   - inline "is this correct?" feedback: Да confirms the auto-location,
 *     Не opens the correction modal
 *   - when there are no coordinates at all, a single "посочи" action
 *
 * Responsive layout:
 *   - mobile: a compact header (settlement + chip + address) with a
 *     chevron that reveals the map + confirm row. Default collapsed so
 *     the preview doesn't blow vertical real estate on small screens.
 *   - desktop: a two-column layout with text on the left and a small
 *     mini-map on the right. Always expanded; the chevron is hidden.
 *
 * Used by every surface that shows a section — the anomaly sidebar, the
 * sections-table drilldown, the persistence popover, the section-detail
 * page. The same component handles all of them so the affordances are
 * consistent everywhere.
 */

const SECTION_TYPE_LABELS: Record<string, string> = {
  mobile: "Подвижна",
  hospital: "Болница",
  abroad: "Чужбина",
  prison: "Затвор",
};

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
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const hasCoords = lat != null && lng != null;
  const typeLabel = sectionType ? SECTION_TYPE_LABELS[sectionType] : null;
  // Prefer the coordinates we're showing on our mini-map — that way Google
  // Maps drops the user exactly where we think the section is. If the pin
  // is wrong, the "Не" button below lets them correct it.
  const googleMapsHref = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, ${settlementName ?? ""}, Bulgaria`)}`
      : null;

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
      setConfirmState("error");
    }
  }

  // The text block (settlement, chip, address) — identical content on both
  // layouts, just re-flowed.
  const textBlock = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-display text-base font-semibold leading-tight text-foreground md:text-lg">
          {settlementName ?? "—"}
        </span>
        {typeLabel && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {typeLabel}
          </span>
        )}
      </div>
      {address && (
        <div className="mt-0.5 flex items-start gap-1 text-sm leading-snug text-muted-foreground">
          <MapPin size={11} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {address}
            {googleMapsHref && (
              <>
                {" "}
                <a
                  href={googleMapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-score-high hover:underline"
                  title="Виж в Google Maps"
                >
                  ↗
                </a>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );

  // The confirm-location action row.
  const confirmRow = hasCoords ? (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
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
              className="rounded border border-brand px-2.5 py-0.5 font-medium text-score-high transition-colors hover:bg-brand hover:text-white"
            >
              Не
            </button>
          </div>
          {confirmState === "error" && (
            <span className="w-full text-2xs text-score-high">
              Грешка при изпращане. Опитайте отново.
            </span>
          )}
        </>
      )}
    </div>
  ) : (
    <button
      onClick={() => setShowCorrection(true)}
      className="w-full rounded-md border border-brand px-3 py-1.5 text-xs font-medium text-score-high transition-colors hover:bg-brand hover:text-white"
    >
      Посочете секцията на картата →
    </button>
  );

  const mapBlockMobile = hasCoords ? (
    <SectionMap lat={lat} lng={lng} showAttribution={false} />
  ) : (
    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
      Няма координати
    </div>
  );

  // Desktop map — full width, shorter than mobile so the info block doesn't
  // dominate the sidebar. Attribution hidden (main map on the page shows it
  // already).
  const geocodeWarning = hasCoords ? (
    <p className="text-2xs leading-snug text-muted-foreground/70">
      Местоположението е определено автоматично по адрес и може да е неточно.
    </p>
  ) : null;

  const mapBlockDesktop = hasCoords ? (
    <SectionMap
      lat={lat}
      lng={lng}
      showAttribution={false}
      className="h-28 rounded-lg border border-border"
    />
  ) : (
    <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
      Няма координати
    </div>
  );

  return (
    <>
      {/* Mobile layout — compact header + collapsible map/actions */}
      <div className="md:hidden">
        <div className="flex items-start gap-2">
          {textBlock}
          <button
            onClick={() => setMobileExpanded((v) => !v)}
            className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            aria-label={mobileExpanded ? "Скрий картата" : "Покажи картата"}
          >
            {mobileExpanded ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        </div>
        {mobileExpanded && (
          <div className="mt-3 space-y-2">
            {geocodeWarning}
            {mapBlockMobile}
            {confirmRow}
          </div>
        )}
      </div>

      {/* Desktop layout — text header, then full-width but shorter map.
          Tried a tiny beside-text mini-map; MapLibre can't render anything
          useful in 112×80 so we took the vertical hit instead. */}
      <div className="hidden md:block">
        {textBlock}
        {geocodeWarning && <div className="mt-2">{geocodeWarning}</div>}
        <div className="mt-1.5">{mapBlockDesktop}</div>
        <div className="mt-2">{confirmRow}</div>
      </div>

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
    </>
  );
}
