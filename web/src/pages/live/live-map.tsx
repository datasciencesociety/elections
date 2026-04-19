import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import type { LiveSection } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";

const SOURCE_ID = "live-sections";
const DISC_LAYER = "live-sections-disc";
const GLYPH_LAYER = "live-sections-glyph";
const BLINK_LAYER = "live-sections-blink";
const DISC_ICON = "live-disc";
const GLYPH_ICON = "live-camera";

/**
 * Two SDF masks are loaded instead of one because MapLibre's SDF pipeline
 * only tints a single silhouette. Stacking a coloured disc below a white
 * camera glyph gives us a two-tone "pin" with one tint per feature — and
 * lets the blink layer pulse only the disc, which reads better than
 * flashing the glyph.
 */
const DISC_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="28" fill="white"/>
</svg>`.trim();

const GLYPH_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64">
  <path fill="white" d="M15 8v-.5a2.5 2.5 0 0 0-2.5-2.5h-7A2.5 2.5 0 0 0 3 7.5v9A2.5 2.5 0 0 0 5.5 19h7a2.5 2.5 0 0 0 2.5-2.5V16l3.7 2.78a1 1 0 0 0 1.6-.8V6.02a1 1 0 0 0-1.6-.8L15 8z"/>
</svg>`.trim();

/**
 * One camera marker per polling section, colour-coded by camera status.
 *   - green disc + white camera → "ok" / "live" stream is up
 *   - red disc + white camera   → "covered" / "dark" / "frozen" — blinks
 *   - grey disc + white camera  → no metrics, no stream yet
 *
 * The blink is a separate disc layer filtered to red tones. The green and
 * grey base stays stable — only the "something is wrong" markers animate.
 *
 * MapLibre only accepts a single zoom-based expression per property, so
 * `icon-size` interpolates on zoom at the top level and chooses per-tone
 * values inside each stop.
 */
export function LiveMapLayer({
  sections,
  metrics,
  liveCodes,
  onClick,
}: {
  sections: LiveSection[];
  metrics: LiveMetrics | undefined;
  liveCodes: Set<string>;
  onClick: (code: string) => void;
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

        // Base disc — coloured by tone.
        if (!map.getLayer(DISC_LAYER)) {
          map.addLayer({
            id: DISC_LAYER,
            type: "symbol",
            source: SOURCE_ID,
            layout: {
              "icon-image": DISC_ICON,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              // Grey discs match the live-disc size so the camera glyph
              // has the same padding ring on every tone — grey is
              // differentiated by colour and opacity, not by being
              // smaller. Green/red stay the same.
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

        // White camera glyph on top. Hidden at very low zoom where the disc
        // is already tiny — adding the glyph there just adds noise.
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

        // Red blink layer — a duplicated disc rendered larger under the red
        // tones, opacity toggled on a timer for a pulse effect.
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
      const code = features[0].properties?.section_code as string | undefined;
      if (code) onClickRef.current(code);
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

  // Update feature data whenever metrics tick or the section list changes.
  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(SOURCE_ID) as MapLibreGL.GeoJSONSource | undefined;
    if (!source) return;

    const features = sections
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [s.lon, s.lat] as [number, number],
        },
        properties: {
          section_code: s.section_code,
          tone: tone(s.section_code, metrics, liveCodes),
        },
      }));

    source.setData({ type: "FeatureCollection", features });
  }, [map, isLoaded, sections, metrics, liveCodes]);

  return null;
}

function tone(
  code: string,
  metrics: LiveMetrics | undefined,
  liveCodes: Set<string>,
): "green" | "red" | "grey" {
  const m = metrics?.[code];
  if (m) {
    if (m.status === "ok") return "green";
    if (m.status === "covered" || m.status === "dark" || m.status === "frozen")
      return "red";
  }
  if (liveCodes.has(code)) return "green";
  return "grey";
}

/**
 * Rasterize an inline SVG to an HTMLImageElement suitable for
 * `map.addImage(..., { sdf: true })`. The shape must be white on
 * transparent so MapLibre builds the SDF from its alpha mask.
 */
function loadSdfImage(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
