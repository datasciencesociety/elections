import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";

const SOURCE_ID = "live-addresses";
const DOT_LAYER = "live-addresses-dot";
const BLINK_LAYER = "live-addresses-blink";

/**
 * One coloured dot per polling address. Circle layer, not SDF icons —
 * rasterizing ~7k camera glyphs through canvas + symbol placement is
 * several seconds of CPU, and the symbol layer occasionally silent-fails
 * when MapLibre can't read the image blob. Dots are boring but reliable:
 * the paint pipeline handles 10k+ circles in a single GL draw call.
 *
 * Tones:
 *   - red   → any section at this address is covered / dark / frozen
 *             (blinks via a second circle layer with animated opacity)
 *   - green → any section is ok or has a live stream
 *   - grey  → no signal yet
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

    let blinkHandle: ReturnType<typeof setInterval> | null = null;
    let blinkOn = true;

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: DOT_LAYER,
      type: "circle",
      source: SOURCE_ID,
      layout: {
        "circle-sort-key": [
          "match",
          ["get", "tone"],
          "red", 2,
          "green", 1,
          0,
        ],
      },
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6, ["match", ["get", "tone"], "grey", 1.5, 3],
          9, ["match", ["get", "tone"], "grey", 2.5, 5],
          12, ["match", ["get", "tone"], "grey", 4, 8],
          15, ["match", ["get", "tone"], "grey", 6, 12],
        ],
        "circle-color": [
          "match",
          ["get", "tone"],
          "green", "#10b981",
          "red", "#ce463c",
          "#9ca3af",
        ],
        "circle-opacity": [
          "match",
          ["get", "tone"],
          "grey", 0.55,
          0.95,
        ],
        "circle-stroke-width": [
          "match",
          ["get", "tone"],
          "grey", 0,
          1,
        ],
        "circle-stroke-color": "rgba(255,255,255,0.9)",
      },
    });

    // Red blink — a halo circle under the red dots, opacity toggled on a
    // timer. Keeping it a separate layer means only red features animate.
    map.addLayer(
      {
        id: BLINK_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["get", "tone"], "red"],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 6,
            9, 10,
            12, 16,
            15, 22,
          ],
          "circle-color": "#ce463c",
          "circle-opacity": 0.4,
        },
      },
      DOT_LAYER,
    );

    blinkHandle = setInterval(() => {
      if (!map.getLayer(BLINK_LAYER)) return;
      blinkOn = !blinkOn;
      map.setPaintProperty(BLINK_LAYER, "circle-opacity", blinkOn ? 0.4 : 0);
    }, 650);

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const layers = [BLINK_LAYER, DOT_LAYER].filter((id) => map.getLayer(id));
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

    for (const id of [DOT_LAYER, BLINK_LAYER]) {
      map.on("click", id, handleClick);
      map.on("mouseenter", id, handleEnter);
      map.on("mouseleave", id, handleLeave);
    }

    return () => {
      if (blinkHandle) clearInterval(blinkHandle);
      for (const id of [DOT_LAYER, BLINK_LAYER]) {
        map.off("click", id, handleClick);
        map.off("mouseenter", id, handleEnter);
        map.off("mouseleave", id, handleLeave);
      }
      try {
        if (map.getLayer(BLINK_LAYER)) map.removeLayer(BLINK_LAYER);
        if (map.getLayer(DOT_LAYER)) map.removeLayer(DOT_LAYER);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* style already destroyed */
      }
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
