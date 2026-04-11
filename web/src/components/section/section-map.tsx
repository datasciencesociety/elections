import {
  Map as MapGL,
  MapMarker,
  MarkerContent,
  MapControls,
} from "@/components/ui/map";

/**
 * Mini map showing a single section as a red pin. Always rendered at zoom
 * 15 with the marker centred. Used by every section view (sidebar,
 * `section-detail` page, `section-preview` popover).
 *
 * If the section has no coordinates, the parent should not render this at
 * all — `<SectionLocation>` already handles the absent-coords case.
 *
 * The `key` on `<MapGL>` is deliberate: the shared map component only
 * syncs its `viewport` prop in "controlled" mode (requires
 * `onViewportChange` too). Here we just want the map to re-center when the
 * user picks a different section in the sidebar, so we remount it on every
 * new coordinate instead of threading a viewport callback through.
 */
export function SectionMap({
  lat,
  lng,
  className = "h-48 rounded-lg border border-border",
  showControls = true,
  showAttribution = true,
}: {
  lat: number;
  lng: number;
  /** Tailwind classes for the outer container. Defaults to a 192px tall
   * card with a border — the full-width sidebar/detail layout. Callers
   * that need a different size pass their own classes. */
  className?: string;
  /** Hide the zoom control on mini-maps where it just adds clutter. */
  showControls?: boolean;
  /** Hide the CARTO/OSM attribution line. Only disable on tiny preview
   * maps where the full attribution is rendered elsewhere on the same
   * page. */
  showAttribution?: boolean;
}) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <MapGL
        key={`${lat},${lng}`}
        viewport={{ center: [lng, lat], zoom: 15, bearing: 0, pitch: 0 }}
        attributionControl={showAttribution ? { compact: true } : false}
      >
        <MapMarker latitude={lat} longitude={lng}>
          <MarkerContent>
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#ce463c] shadow-lg">
              <div className="h-2 w-2 rounded-full bg-white" />
            </div>
          </MarkerContent>
        </MapMarker>
        {showControls && (
          <MapControls position="bottom-right" showZoom showCompass={false} />
        )}
      </MapGL>
    </div>
  );
}
