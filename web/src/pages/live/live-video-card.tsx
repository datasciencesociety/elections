import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { X, ExternalLink, ChartBar } from "lucide-react";
import type { LiveSection } from "@/lib/api/live-sections.js";
import type { LiveSectionMetric } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { LiveStatusBadge, statusTone, type UiStatus } from "./live-status-badge.js";
import { LiveNearbyChips } from "./live-nearby-chips.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";

/**
 * One video/snapshot panel per opened section. The card keeps three things
 * visible at all times — where the section is, what its camera is showing,
 * and how people can drill deeper (full profile, CIK protocol link). The
 * player is best-effort: if the stream URL doesn't exist yet we render the
 * last JPEG snapshot, refreshed on every metrics tick.
 *
 * When the status flips to a red state we pulse the border once. No looping
 * animation — a single cue on a real event.
 */
export function LiveVideoCard({
  section,
  metric,
  streamUrl,
  latestElectionId,
  allSections,
  metrics,
  streamBySection,
  openCodes,
  onOpen,
  onOpenMany,
  onClose,
}: {
  section: LiveSection;
  metric: LiveSectionMetric | undefined;
  streamUrl: string | undefined;
  latestElectionId: string | number | undefined;
  allSections: LiveSection[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  openCodes: string[];
  onOpen: (code: string) => void;
  onOpenMany: (codes: string[]) => void;
  onClose: () => void;
}) {
  const uiStatus = resolveStatus(metric, streamUrl);
  const tone = statusTone(uiStatus);
  const [flash, setFlash] = useState(false);
  const prevToneRef = useRef(tone);

  useEffect(() => {
    if (prevToneRef.current !== "red" && tone === "red") {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
    prevToneRef.current = tone;
  }, [tone]);

  const reportedAgo = metric?.reported_at ? secondsAgo(metric.reported_at) : null;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-md border bg-card shadow-sm",
        flash ? "border-score-high" : "border-border",
      )}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
              {section.section_code}
            </span>
            <LiveStatusBadge status={uiStatus} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={section.address}>
            {section.address}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Затвори"
        >
          <X size={14} />
        </button>
      </header>

      {/* Media */}
      <div className="relative aspect-video w-full bg-black">
        <VideoArea metric={metric} streamUrl={streamUrl} />
      </div>

      {/* Meta + actions */}
      <div className="flex flex-col gap-2 px-3 py-2">
        {reportedAgo != null && (
          <p className="text-3xs uppercase tracking-eyebrow text-muted-foreground">
            обновено преди {reportedAgo} сек.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {latestElectionId != null && (
            <Link
              to={`/section/${section.section_code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <ChartBar size={12} />
              Минали резултати
            </Link>
          )}
          {streamUrl && (
            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <ExternalLink size={12} />
              Отвори стрийма
            </a>
          )}
        </div>
      </div>

      <LiveNearbyChips
        target={section}
        allSections={allSections}
        metrics={metrics}
        streamBySection={streamBySection}
        openCodes={openCodes}
        onOpen={onOpen}
        onOpenMany={onOpenMany}
      />
    </article>
  );
}

/**
 * Cameras start publishing after the polling stations close at 20:00 Sofia
 * time. ISO-8601 with an explicit `+03:00` anchors the cutoff to Sofia EEST
 * regardless of where the viewer is.
 */
const STREAM_START_ISO = "2026-04-19T20:00:00+03:00";

function VideoArea({
  metric,
  streamUrl,
}: {
  metric: LiveSectionMetric | undefined;
  streamUrl: string | undefined;
}) {
  // Live stream takes priority. If it can't play, the browser shows the
  // poster (snapshot) and we still get useful signal.
  if (streamUrl) {
    return (
      <video
        key={streamUrl}
        src={streamUrl}
        poster={metric?.snapshot_url}
        autoPlay
        muted
        playsInline
        controls
        className="h-full w-full object-contain"
      />
    );
  }

  if (metric?.snapshot_url) {
    return <SnapshotImage url={metric.snapshot_url} reportedAt={metric.reported_at} />;
  }

  // No stream and no snapshot — explain why, differentiated by whether
  // the official broadcast window has opened yet.
  const beforeCutoff = Date.now() < Date.parse(STREAM_START_ISO);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground/70">
        изборен ден · 19 април 2026
      </p>
      {beforeCutoff ? (
        <>
          <p className="font-display text-lg leading-tight text-background">
            Камерите тръгват в 20:00 ч.
          </p>
          <p className="text-xs text-muted-foreground">
            След затваряне на секциите ще покажем стрийма на преброяването от ЦИК.
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-lg leading-tight text-background">
            Очакваме стрийма всеки момент
          </p>
          <p className="text-xs text-muted-foreground">
            Секцията все още не излъчва. Опресняваме всеки 5 сек.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Refresh the snapshot once per polling window by bumping a cache-busting
 * query param tied to `reportedAt`. If the metrics payload didn't update the
 * timestamp we still pull once a minute as a safety net.
 */
function SnapshotImage({ url, reportedAt }: { url: string; reportedAt?: number }) {
  const [nonce, setNonce] = useState(() => reportedAt ?? Date.now());
  useEffect(() => {
    if (reportedAt) setNonce(reportedAt);
  }, [reportedAt]);
  useEffect(() => {
    const t = setInterval(() => setNonce(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const sep = url.includes("?") ? "&" : "?";
  return (
    <img
      src={`${url}${sep}t=${nonce}`}
      alt="Последен кадър"
      className="h-full w-full object-contain"
    />
  );
}

function resolveStatus(
  metric: LiveSectionMetric | undefined,
  streamUrl: string | undefined,
): UiStatus {
  if (streamUrl && (!metric || metric.status === "ok")) return "live";
  if (!metric) return "no_camera";
  return metric.status;
}

function secondsAgo(ts: number): number {
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}
