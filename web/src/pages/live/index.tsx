import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LiveMapLayer, addressTone } from "./live-map.js";
import { LiveSearch } from "./live-search.js";
import { LiveSectionPopup } from "./live-section-popup.js";
import { LiveHoverTooltip } from "./live-hover-tooltip.js";
import { LiveVideoPanel } from "./live-video-panel.js";
import { LiveStatusBadge } from "./live-status-badge.js";
import { LiveSignalList } from "./live-signal-list.js";

const MOBILE_BREAKPOINT = 768;

/**
 * Election-day live camera page.
 *
 * Flow:
 *   1. Map shows one pin per polling address, coloured by the worst-case
 *      status of its sections.
 *   2. Click a pin (or search result) → a map popup lists the address's
 *      sections with a "гледай" button each. The popup stays open so the
 *      viewer can queue several cameras.
 *   3. Each added section becomes a card in the side panel, showing the
 *      CIK stream in an iframe (same-origin safety) plus a past-results
 *      link.
 *
 * Mobile: the panel is capped at one card so the stream isn't stamp-size.
 */
export default function Live() {
  const { data: addresses = [], isLoading: addressesLoading } = useLiveAddresses();
  const { data: liveMetrics } = useLiveMetrics();
  const { data: streamsDir } = useLiveStreamsDirectory();

  const [searchParams] = useSearchParams();
  const demoMode = searchParams.get("demo") === "1";

  const isMobile = useIsMobile();
  const [watchCodes, setWatchCodes] = useState<string[]>([]);
  const [popupAddressId, setPopupAddressId] = useState<string | null>(null);
  const [hoverAddressId, setHoverAddressId] = useState<string | null>(null);
  const [signalListOpen, setSignalListOpen] = useState(false);
  const mapRef = useRef<MapLibreGL.Map | null>(null);

  const realStreamBySection = useMemo(() => {
    const m = new Map<string, string>();
    for (const raw of streamsDir?.sections ?? []) {
      const entry = raw as LiveStreamEntry;
      const code = entry.id ?? entry.section_code;
      const url = entry.url ?? entry.stream_url ?? entry.hls_url;
      if (code && typeof url === "string" && url.length > 0) {
        m.set(code, url);
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

  // Reverse index so a watched section code can resolve to its address
  // (for the card header + nearby chips).
  const addressBySectionCode = useMemo(() => {
    const m = new Map<string, LiveAddress>();
    for (const a of addresses) {
      for (const code of a.section_codes) m.set(code, a);
    }
    return m;
  }, [addresses]);

  const handleOpenPopup = useCallback(
    (id: string) => {
      const address = addressById.get(id);
      if (!address) return;
      setPopupAddressId(id);
      const map = mapRef.current;
      if (
        map &&
        Number.isFinite(address.lat) &&
        Number.isFinite(address.lon)
      ) {
        map.easeTo({
          center: [address.lon, address.lat],
          zoom: Math.max(map.getZoom(), 12),
          duration: 500,
        });
      }
    },
    [addressById],
  );

  const handleClosePopup = useCallback(() => setPopupAddressId(null), []);

  const handleWatch = useCallback(
    (code: string) => {
      setWatchCodes((prev) => {
        if (prev.includes(code)) return prev;
        // Mobile is capped at one card — replace the existing watched
        // section so the screen shows exactly what the user just picked.
        if (isMobile) return [code];
        return [code, ...prev];
      });
    },
    [isMobile],
  );

  const handleClose = useCallback(
    (code: string) => setWatchCodes((prev) => prev.filter((c) => c !== code)),
    [],
  );

  const popupAddress = popupAddressId ? addressById.get(popupAddressId) ?? null : null;
  // Suppress the hover tooltip when the click popup is already showing
  // the same address — one info card beats two stacked on the same pin.
  const hoverAddress =
    hoverAddressId && hoverAddressId !== popupAddressId
      ? addressById.get(hoverAddressId) ?? null
      : null;

  // Count marker tones so the header numbers agree with the map: "на живо"
  // = green dots, "сигнали" = red dots. Previously this counted raw metric
  // entries, which included sections that don't appear on our map (e.g.
  // coordinator tests), producing phantom сигнали with no red pin.
  const stats = useMemo(() => {
    let live = 0;
    let flagged = 0;
    for (const a of addresses) {
      const t = addressTone(a, metrics, liveCodes);
      if (t === "red") flagged++;
      else if (t === "green") live++;
    }
    return { live, flagged, total: addresses.length };
  }, [metrics, liveCodes, addresses]);

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
          <LiveSearch
            addresses={addresses}
            onPick={(a) => handleOpenPopup(a.id)}
          />
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
                на живо ·{" "}
                <button
                  type="button"
                  onClick={() => setSignalListOpen((v) => !v)}
                  className="cursor-pointer text-score-high underline-offset-2 hover:underline"
                  title="Покажи кои секции са сигнализирали"
                >
                  {stats.flagged.toLocaleString("bg-BG")}
                </button>{" "}
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

        {signalListOpen && (
          <LiveSignalList
            addresses={addresses}
            metrics={metrics}
            liveCodes={liveCodes}
            addressBySectionCode={addressBySectionCode}
            onPick={(id) => {
              setSignalListOpen(false);
              handleOpenPopup(id);
            }}
            onClose={() => setSignalListOpen(false)}
          />
        )}

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
            onClick={handleOpenPopup}
            onHover={setHoverAddressId}
          />

          {hoverAddress && (
            <LiveHoverTooltip
              address={hoverAddress}
              metrics={metrics}
              liveCodes={liveCodes}
            />
          )}

          {popupAddress && (
            <LiveSectionPopup
              address={popupAddress}
              metrics={metrics}
              streamBySection={streamBySection}
              watchCodes={watchCodes}
              canAddMore={!isMobile || watchCodes.length === 0}
              onWatch={handleWatch}
              onClose={handleClosePopup}
            />
          )}
        </LibreMap>
      </div>

      <LiveVideoPanel
        watchCodes={watchCodes}
        addressBySectionCode={addressBySectionCode}
        metrics={metrics}
        streamBySection={streamBySection}
        onClose={handleClose}
      />
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}
