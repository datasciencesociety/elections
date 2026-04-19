import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type MapLibreGL from "maplibre-gl";
import { Map as LibreMap } from "@/components/ui/map";
import { useLiveAddresses } from "@/lib/hooks/use-live-sections.js";
import {
  useLiveMetrics,
  useLiveStreamsDirectory,
} from "@/lib/hooks/use-live-metrics.js";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveStreamEntry } from "@/lib/api/live-metrics.js";
import { buildDemo } from "./demo.js";

import {
  BULGARIA_CENTER,
  BULGARIA_ZOOM,
} from "@/pages/anomaly-map/map/constants.js";
import { LiveMapLayer } from "./live-map.js";
import { LiveSearch } from "./live-search.js";
import { LiveVideoPanel } from "./live-video-panel.js";
import { LiveStatusBadge } from "./live-status-badge.js";

/**
 * Election-day live camera page. Public can find their polling address on
 * the map or search by address/section code, then open the CIK
 * livestream in a side drawer. Multiple cards can be open at once — the
 * drawer grows columns as needed.
 *
 * This page is temporary: routed at `/` as the home for 2026-04-19.
 * After tonight we either delete it or date-gate the redirect.
 *
 * Data flow:
 *   - Polling-address index → static JSON, loaded once (useLiveAddresses).
 *   - Per-section camera health → 5 s poll of /video/metrics.
 *   - Active stream URLs → 5 s poll of /video/sections.
 *   - ?demo=1 → replaces both with synthetic data so every state can be
 *     previewed.
 */
export default function Live() {
  const { data: addresses = [], isLoading: addressesLoading } = useLiveAddresses();
  const { data: liveMetrics } = useLiveMetrics();
  const { data: streamsDir } = useLiveStreamsDirectory();

  const [searchParams] = useSearchParams();
  const demoMode = searchParams.get("demo") === "1";

  const [openIds, setOpenIds] = useState<string[]>([]);
  const mapRef = useRef<MapLibreGL.Map | null>(null);

  const realStreamBySection = useMemo(() => {
    const m = new Map<string, string>();
    for (const raw of streamsDir?.sections ?? []) {
      const entry = raw as LiveStreamEntry;
      if (!entry.section_code) continue;
      const url = entry.stream_url ?? entry.hls_url;
      if (typeof url === "string" && url.length > 0) {
        m.set(entry.section_code, url);
      }
    }
    return m;
  }, [streamsDir]);

  const demo = useMemo(
    () => (demoMode ? buildDemo(addresses) : null),
    [demoMode, addresses],
  );
  const metrics = demo?.metrics ?? liveMetrics;
  const streamBySection = demo?.streamBySection ?? realStreamBySection;

  const liveCodes = useMemo(
    () => new Set(streamBySection.keys()),
    [streamBySection],
  );

  const addressById = useMemo(() => {
    const m = new Map<string, LiveAddress>();
    for (const a of addresses) m.set(a.id, a);
    return m;
  }, [addresses]);

  const openAddresses = openIds
    .map((id) => addressById.get(id))
    .filter((a): a is LiveAddress => !!a);

  const handleOpen = useCallback(
    (id: string) => {
      const address = addressById.get(id);
      if (!address) return;
      setOpenIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
      const map = mapRef.current;
      if (
        map &&
        Number.isFinite(address.lat) &&
        Number.isFinite(address.lon)
      ) {
        // Zoom to neighbourhood level so surrounding markers stay visible.
        map.easeTo({
          center: [address.lon, address.lat],
          zoom: Math.max(map.getZoom(), 12),
          duration: 700,
        });
      }
    },
    [addressById],
  );

  const handleClose = useCallback(
    (id: string) => setOpenIds((prev) => prev.filter((x) => x !== id)),
    [],
  );

  const stats = useMemo(() => {
    let live = 0;
    let flagged = 0;
    for (const code of liveCodes) {
      const status = metrics?.[code]?.status;
      if (status === "covered" || status === "dark" || status === "frozen") {
        flagged++;
      } else {
        live++;
      }
    }
    if (metrics) {
      for (const [code, m] of Object.entries(metrics)) {
        if (liveCodes.has(code)) continue;
        if (m.status === "covered" || m.status === "dark" || m.status === "frozen") {
          flagged++;
        }
      }
    }
    return { live, flagged, total: addresses.length };
  }, [metrics, liveCodes, addresses.length]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute left-3 right-3 top-3 z-10 flex flex-col gap-2 md:right-auto md:w-[min(460px,calc(100%-14rem))]">
          <div className="rounded-md border border-border bg-background/95 px-3 py-1.5 shadow-sm backdrop-blur md:py-2">
            <p className="flex items-baseline gap-2 font-display text-sm font-medium leading-tight tracking-tight text-foreground md:hidden">
              <span className="text-2xs font-medium uppercase tracking-eyebrow text-muted-foreground">
                19.04
              </span>
              Народно събрание · на живо
            </p>
            <p className="hidden text-2xs font-medium uppercase tracking-eyebrow text-muted-foreground md:block">
              19 април 2026 · на живо
              {demoMode && (
                <span className="ml-2 rounded bg-score-high/10 px-1.5 py-0.5 text-3xs uppercase tracking-wide text-score-high">
                  демо
                </span>
              )}
            </p>
            <h1 className="mt-0.5 hidden font-display font-medium leading-tight tracking-tight text-foreground md:block md:text-2xl">
              Избори за народни представители
            </h1>
          </div>
          <LiveSearch addresses={addresses} onPick={(a) => handleOpen(a.id)} />
        </div>

        <div className="absolute right-3 top-3 z-10 hidden flex-col items-end gap-1.5 md:flex">
          <div className="rounded-md border border-border bg-card/95 px-2.5 py-1.5 font-mono text-2xs tabular-nums text-muted-foreground shadow-sm backdrop-blur">
            {addressesLoading ? (
              "…"
            ) : (
              <>
                <span className="text-foreground">
                  {stats.live.toLocaleString("bg-BG")}
                </span>{" "}
                на живо · <span className="text-score-high">
                  {stats.flagged.toLocaleString("bg-BG")}
                </span>{" "}
                сигнали /{" "}
                <span className="text-foreground">
                  {stats.total.toLocaleString("bg-BG")}
                </span>{" "}
                адреса
              </>
            )}
          </div>
          <div className="flex gap-2 rounded-md border border-border bg-card/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
            <LiveStatusBadge status="live" />
            <LiveStatusBadge status="covered" />
            <LiveStatusBadge status="no_camera" />
          </div>
        </div>

        <LibreMap
          center={BULGARIA_CENTER}
          zoom={BULGARIA_ZOOM}
          className="h-full w-full"
          loading={addressesLoading}
          ref={mapRef}
        >
          <LiveMapLayer
            addresses={addresses}
            metrics={metrics}
            liveCodes={liveCodes}
            onClick={handleOpen}
          />
        </LibreMap>
      </div>

      <LiveVideoPanel
        openAddresses={openAddresses}
        openIds={openIds}
        allAddresses={addresses}
        metrics={metrics}
        streamBySection={streamBySection}
        liveCodes={liveCodes}
        onOpen={handleOpen}
        onClose={handleClose}
      />
    </div>
  );
}
