import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";

const SOURCE_ID = "live-addresses";
const DISC_LAYER = "live-addresses-disc";
const GLYPH_LAYER = "live-addresses-glyph";
const BLINK_LAYER = "live-addresses-blink";
const DISC_ICON = "live-disc";
const GLYPH_ICON = "live-camera";

const DISC_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="28" fill="white"/>
</svg>`.trim();

const GLYPH_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64">
  <path fill="white" d="M15 8v-.5a2.5 2.5 0 0 0-2.5-2.5h-7A2.5 2.5 0 0 0 3 7.5v9A2.5 2.5 0 0 0 5.5 19h7a2.5 2.5 0 0 0 2.5-2.5V16l3.7 2.78a1 1 0 0 0 1.6-.8V6.02a1 1 0 0 0-1.6-.8L15 8z"/>
</svg>`.trim();

/**
 * One camera marker per polling address. A school with 10 rooms is one
 * pin, coloured by the worst-case status of its 10 sections:
 *   - red   → any section is covered / dark / frozen (blinks)
 *   - green → any section is ok or has a live stream
 *   - grey  → no section at this address has any signal
 *
 * Aggregating at the address keeps MapLibre from stacking identical icons
 * on the same coordinate — the previous per-section layer rendered 11k
 * dots into ~6.9k unique points, which was both slow and visually
 * indistinguishable from silence.
 */
export function LiveMapLayer({
  addresses,
  metrics,
  liveCodes,
  onClick,
}: {
  addresses: LiveAddress[];
  metrics: LiveMetrics | undefined;
  liveCodes: Set<string>;
  onClick: (addressId: string) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!map || !isLoaded) return;
    if (map.getSource(SOURCE_ID)) return;

    let cancelled = false;
    let blinkHandle: ReturnType<typeof setInterval> | null = null;
    let blinkOn = true;

    const cleanup = () => {
      cancelled = true;
      if (blinkHandle) clearInterval(blinkHandle);
      try {
        if (map.getLayer(BLINK_LAYER)) map.removeLayer(BLINK_LAYER);
        if (map.getLayer(GLYPH_LAYER)) map.removeLayer(GLYPH_LAYER);
        if (map.getLayer(DISC_LAYER)) map.removeLayer(DISC_LAYER);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        if (map.hasImage(DISC_ICON)) map.removeImage(DISC_ICON);
        if (map.hasImage(GLYPH_ICON)) map.removeImage(GLYPH_ICON);
      } catch {
        /* style already destroyed */
      }
    };

    Promise.all([loadSdfImage(DISC_SVG), loadSdfImage(GLYPH_SVG)]).then(
      ([discImg, glyphImg]) => {
        if (cancelled || !map || !discImg || !glyphImg) return;
        if (!map.hasImage(DISC_ICON)) map.addImage(DISC_ICON, discImg, { sdf: true });
        if (!map.hasImage(GLYPH_ICON)) map.addImage(GLYPH_ICON, glyphImg, { sdf: true });

        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
        }

        if (!map.getLayer(DISC_LAYER)) {
          map.addLayer({
            id: DISC_LAYER,
            type: "symbol",
            source: SOURCE_ID,
            layout: {
              "icon-image": DISC_ICON,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                6, 0.18,
                9, 0.3,
                12, 0.45,
                15, 0.65,
              ],
              "symbol-sort-key": [
                "match",
                ["get", "tone"],
                "red", 0,
                "green", 1,
                2,
              ],
            },
            paint: {
              "icon-color": [
                "match",
                ["get", "tone"],
                "green", "#10b981",
                "red", "#ce463c",
                "#9ca3af",
              ],
              "icon-opacity": [
                "match",
                ["get", "tone"],
                "grey", 0.7,
                1,
              ],
              "icon-halo-color": "rgba(255,255,255,0.95)",
              "icon-halo-width": 1,
            },
          });
        }

        if (!map.getLayer(GLYPH_LAYER)) {
          map.addLayer({
            id: GLYPH_LAYER,
            type: "symbol",
            source: SOURCE_ID,
            minzoom: 8,
            layout: {
              "icon-image": GLYPH_ICON,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                8, 0.18,
                12, 0.32,
                15, 0.45,
              ],
              "symbol-sort-key": [
                "match",
                ["get", "tone"],
                "red", 0,
                "green", 1,
                2,
              ],
            },
            paint: {
              "icon-color": "#ffffff",
              "icon-opacity": [
                "match",
                ["get", "tone"],
                "grey", 0.85,
                1,
              ],
            },
          });
        }

        if (!map.getLayer(BLINK_LAYER)) {
          map.addLayer(
            {
              id: BLINK_LAYER,
              type: "symbol",
              source: SOURCE_ID,
              filter: ["==", ["get", "tone"], "red"],
              layout: {
                "icon-image": DISC_ICON,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-size": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  6, 0.32,
                  9, 0.52,
                  12, 0.85,
                  15, 1.2,
                ],
              },
              paint: {
                "icon-color": "#ce463c",
                "icon-opacity": 0.45,
              },
            },
            DISC_LAYER,
          );
        }

        blinkHandle = setInterval(() => {
          if (!map.getLayer(BLINK_LAYER)) return;
          blinkOn = !blinkOn;
          map.setPaintProperty(BLINK_LAYER, "icon-opacity", blinkOn ? 0.45 : 0);
        }, 650);
      },
    );

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const layers = [BLINK_LAYER, DISC_LAYER, GLYPH_LAYER].filter((id) =>
        map.getLayer(id),
      );
      if (layers.length === 0) return;
      const features = map.queryRenderedFeatures(e.point, { layers });
      if (!features.length) return;
      const id = features[0].properties?.id as string | undefined;
      if (id) onClickRef.current(id);
    };
    const handleEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    for (const id of [DISC_LAYER, GLYPH_LAYER, BLINK_LAYER]) {
      map.on("click", id, handleClick);
      map.on("mouseenter", id, handleEnter);
      map.on("mouseleave", id, handleLeave);
    }

    return () => {
      for (const id of [DISC_LAYER, GLYPH_LAYER, BLINK_LAYER]) {
        map.off("click", id, handleClick);
        map.off("mouseenter", id, handleEnter);
        map.off("mouseleave", id, handleLeave);
      }
      cleanup();
    };
  }, [map, isLoaded]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(SOURCE_ID) as MapLibreGL.GeoJSONSource | undefined;
    if (!source) return;

    const features = addresses
      .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
      .map((a) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [a.lon, a.lat] as [number, number],
        },
        properties: {
          id: a.id,
          tone: addressTone(a, metrics, liveCodes),
        },
      }));

    source.setData({ type: "FeatureCollection", features });
  }, [map, isLoaded, addresses, metrics, liveCodes]);

  return null;
}

/**
 * Worst-case aggregate: if any section at this address has a problem, the
 * pin is red. Green wins over grey. Grey only when nothing at all is
 * known.
 */
export function addressTone(
  address: LiveAddress,
  metrics: LiveMetrics | undefined,
  liveCodes: Set<string>,
): "green" | "red" | "grey" {
  let anyGreen = false;
  for (const code of address.section_codes) {
    const m = metrics?.[code];
    if (m) {
      if (m.status === "covered" || m.status === "dark" || m.status === "frozen") {
        return "red";
      }
      if (m.status === "ok") anyGreen = true;
    }
    if (liveCodes.has(code)) anyGreen = true;
  }
  return anyGreen ? "green" : "grey";
}

function loadSdfImage(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
