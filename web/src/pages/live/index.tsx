import { useCallback, useMemo, useRef, useState } from "react";
import type MapLibreGL from "maplibre-gl";
import { Map as LibreMap } from "@/components/ui/map";
import { useLiveSections } from "@/lib/hooks/use-live-sections.js";
import {
  useLiveMetrics,
  useLiveStreamsDirectory,
} from "@/lib/hooks/use-live-metrics.js";
import { useElections } from "@/lib/hooks/use-elections.js";
import type { LiveSection } from "@/lib/api/live-sections.js";
import type { LiveStreamEntry } from "@/lib/api/live-metrics.js";

import {
  BULGARIA_CENTER,
  BULGARIA_ZOOM,
} from "@/pages/anomaly-map/map/constants.js";
import { LiveMapLayer } from "./live-map.js";
import { LiveSearch } from "./live-search.js";
import { LiveVideoPanel } from "./live-video-panel.js";
import { LiveStatusBadge } from "./live-status-badge.js";

/**
 * Election-day live camera page. Public can find their polling section on
 * the map or search by address, then open the CIK livestream in a side
 * drawer. Multiple panels can be open at once — observers want to watch
 * several rooms in parallel.
 *
 * This page is intentionally temporary. After 2026-04-19 we either delete
 * it or date-gate it; no URL-state persistence for the open-panels list,
 * no deep linking, no history.
 *
 * Data flow:
 *   - Polling-section index → static JSON, loaded once (`useLiveSections`).
 *   - Per-section camera health → 5s poll of `/video/metrics`.
 *   - Active stream URLs → 5s poll of `/video/sections`. Source of truth
 *     for "can I play a stream right now".
 */
export default function Live() {
  const { data: sections = [], isLoading: sectionsLoading } = useLiveSections();
  const { data: metrics } = useLiveMetrics();
  const { data: streamsDir } = useLiveStreamsDirectory();
  const { data: elections = [] } = useElections();
  const latestElectionId = elections[0]?.id;

  const [openCodes, setOpenCodes] = useState<string[]>([]);
  const mapRef = useRef<MapLibreGL.Map | null>(null);

  const streamBySection = useMemo(() => {
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

  const liveCodes = useMemo(
    () => new Set(streamBySection.keys()),
    [streamBySection],
  );

  const sectionByCode = useMemo(() => {
    const m = new Map<string, LiveSection>();
    for (const s of sections) m.set(s.section_code, s);
    return m;
  }, [sections]);

  const openSections = openCodes
    .map((c) => sectionByCode.get(c))
    .filter((s): s is LiveSection => !!s);

  const handleOpen = useCallback(
    (code: string) => {
      const section = sectionByCode.get(code);
      if (!section) return;
      setOpenCodes((prev) =>
        prev.includes(code) ? prev : [code, ...prev],
      );
      const map = mapRef.current;
      if (map && Number.isFinite(section.lat) && Number.isFinite(section.lon)) {
        // Zoom to neighborhood level (~12) not building level — the user
        // usually wants to see the picked section *and* its neighbours, not
        // a single pin filling the viewport.
        map.easeTo({
          center: [section.lon, section.lat],
          zoom: Math.max(map.getZoom(), 12),
          duration: 700,
        });
      }
    },
    [sectionByCode],
  );

  const handleOpenMany = useCallback(
    (codes: string[]) => {
      setOpenCodes((prev) => {
        const seen = new Set(prev);
        const additions: string[] = [];
        for (const c of codes) {
          if (!seen.has(c)) {
            additions.push(c);
            seen.add(c);
          }
        }
        return additions.length ? [...additions, ...prev] : prev;
      });
    },
    [],
  );

  const handleClose = useCallback(
    (code: string) => setOpenCodes((prev) => prev.filter((c) => c !== code)),
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
    return { live, flagged, total: sections.length };
  }, [metrics, liveCodes, sections.length]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Map column */}
      <div className="relative flex-1 overflow-hidden">
        {/* Title block + search — the search sits under a proper date-
            stamped heading so election day reads as an event, not a
            utility. Typography-led, Danish-poster rules: one display
            face, one eyebrow line, no decoration. */}
        <div className="absolute left-3 top-3 z-10 flex w-[min(460px,calc(100%-6rem))] flex-col gap-2">
          <div className="rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
            <p className="text-2xs font-medium uppercase tracking-eyebrow text-muted-foreground">
              19 април 2026 · на живо
            </p>
            <h1 className="mt-0.5 font-display text-xl font-medium leading-tight tracking-tight text-foreground md:text-2xl">
              Избори за народни представители
            </h1>
          </div>
          <LiveSearch sections={sections} onPick={(s) => handleOpen(s.section_code)} />
        </div>

        {/* Stats + legend chip */}
        <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
          <div className="rounded-md border border-border bg-card/95 px-2.5 py-1.5 font-mono text-2xs tabular-nums text-muted-foreground shadow-sm backdrop-blur">
            {sectionsLoading ? (
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
                секции
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
          loading={sectionsLoading}
          ref={mapRef}
        >
          <LiveMapLayer
            sections={sections}
            metrics={metrics}
            liveCodes={liveCodes}
            onClick={handleOpen}
          />
        </LibreMap>
      </div>

      <LiveVideoPanel
        openSections={openSections}
        openCodes={openCodes}
        allSections={sections}
        metrics={metrics}
        streamBySection={streamBySection}
        latestElectionId={latestElectionId}
        onOpen={handleOpen}
        onOpenMany={handleOpenMany}
        onClose={handleClose}
      />
    </div>
  );
}
