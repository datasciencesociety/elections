import { useState, useEffect, useRef } from "react";
import { Map, useMap } from "@/components/ui/map";
import MapLibreGL from "maplibre-gl";

export const SUBMIT_URL =
  ((import.meta as any).env?.VITE_CORRECTION_SHEET_URL as string | undefined) ??
  "https://script.google.com/macros/s/AKfycbwPXGgqgruuWemNRAft0UtufkZhsm8CINDBjvN2liGVYrIlYjxlDnd5sSbxw-GPjyur/exec";

/**
 * Fire-and-forget confirmation that the auto-geocoded location is correct.
 * Hits the same Google Apps Script endpoint used for corrections, with
 * `type=confirm` so the maintainer can filter the sheet later.
 *
 * Uses GET + no-cors for the same reason the correction flow does: Google
 * Apps Script doesn't do CORS for POST from browsers. The response is
 * opaque, so we treat any resolved promise as success.
 */
export async function submitLocationConfirmation(args: {
  sectionCode: string;
  electionId: string | number;
  settlementName: string;
  address: string | null;
  lat: number;
  lng: number;
}): Promise<void> {
  if (!SUBMIT_URL) throw new Error("Missing VITE_CORRECTION_SHEET_URL");
  const params = new URLSearchParams({
    type: "confirm",
    section_code: args.sectionCode,
    election_id: String(args.electionId),
    lat: String(args.lat),
    lng: String(args.lng),
    settlement_name: args.settlementName,
    address: args.address ?? "",
    timestamp: new Date().toISOString(),
  });
  await fetch(`${SUBMIT_URL}?${params}`, { mode: "no-cors" });
}

const BULGARIA_CENTER: [number, number] = [25.5, 42.7];

interface LocationCorrectionProps {
  sectionCode: string;
  electionId: string;
  settlementName: string;
  address: string | null;
  currentLat: number | null;
  currentLng: number | null;
  onClose: () => void;
}

function MarkerLayer({
  position,
  onMapClick,
}: {
  position: [number, number] | null;
  onMapClick: (lngLat: [number, number]) => void;
}) {
  const { map, isLoaded } = useMap();
  const markerRef = useRef<MapLibreGL.Marker | null>(null);

  // Handle clicks on the map
  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      onMapClick([e.lngLat.lng, e.lngLat.lat]);
    };

    map.on("click", handleClick);
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      map.off("click", handleClick);
      map.getCanvas().style.cursor = "";
    };
  }, [map, isLoaded, onMapClick]);

  // Render/move marker
  useEffect(() => {
    if (!map || !isLoaded) return;

    if (position) {
      if (markerRef.current) {
        markerRef.current.setLngLat(position);
      } else {
        markerRef.current = new MapLibreGL.Marker({ color: "#ef4444", draggable: true })
          .setLngLat(position)
          .addTo(map);

        markerRef.current.on("dragend", () => {
          const lngLat = markerRef.current!.getLngLat();
          onMapClick([lngLat.lng, lngLat.lat]);
        });
      }
    }

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [map, isLoaded, position]);

  return null;
}

export default function LocationCorrection({
  sectionCode,
  electionId,
  settlementName,
  address,
  currentLat,
  currentLng,
  onClose,
}: LocationCorrectionProps) {
  const [markerPos, setMarkerPos] = useState<[number, number] | null>(
    currentLat && currentLng ? [currentLng, currentLat] : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const center: [number, number] =
    currentLng && currentLat ? [currentLng, currentLat] : BULGARIA_CENTER;
  const zoom = currentLat ? 15 : 7;

  const handleSubmit = async () => {
    if (!markerPos) return;

    if (!SUBMIT_URL) {
      setError("Липсва конфигурация за изпращане (VITE_CORRECTION_SHEET_URL)");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Google Apps Script doesn't support CORS for POST from browsers.
      // Use GET with query params — works from any origin, no CORS issues.
      // The Apps Script doGet(e) reads e.parameter.section_code etc.
      const params = new URLSearchParams({
        section_code: sectionCode,
        election_id: electionId,
        lat: String(markerPos[1]),
        lng: String(markerPos[0]),
        settlement_name: settlementName,
        address: address ?? "",
        current_lat: String(currentLat ?? ""),
        current_lng: String(currentLng ?? ""),
        timestamp: new Date().toISOString(),
      });
      await fetch(`${SUBMIT_URL}?${params}`, { mode: "no-cors" });
      setSubmitted(true);
    } catch {
      // no-cors responses are opaque — treat as success
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="rounded-lg bg-background p-6 text-center shadow-xl">
          <div className="mb-2 text-lg font-bold">Благодарим!</div>
          <div className="mb-4 text-sm text-muted-foreground">
            Корекцията е изпратена и ще бъде прегледана.
          </div>
          <button
            onClick={onClose}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Затвори
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <span className="text-sm font-bold">{sectionCode}</span>
          <span className="ml-2 text-xs text-muted-foreground">{settlementName}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Откажи
        </button>
      </div>

      {/* Instructions */}
      <div className="border-b border-border bg-secondary/50 px-4 py-2">
        <div className="text-xs text-muted-foreground">
          Кликнете на картата за да поставите маркер на правилното място.
          Можете да го преместите с влачене.
        </div>
        {address && (
          <div className="mt-1 text-xs font-medium">{address}</div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <Map center={center} zoom={zoom} className="h-full w-full">
          <MarkerLayer position={markerPos} onMapClick={setMarkerPos} />
        </Map>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {markerPos
            ? `${markerPos[1].toFixed(6)}, ${markerPos[0].toFixed(6)}`
            : "Няма маркер"}
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <button
          onClick={handleSubmit}
          disabled={!markerPos || submitting}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {submitting ? "Изпращане..." : "Изпрати корекция"}
        </button>
      </div>
    </div>
  );
}
