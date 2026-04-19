import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { X, ChartBar } from "lucide-react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveSectionMetric } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import {
  LiveStatusBadge,
  statusTone,
  type UiStatus,
} from "./live-status-badge.js";

/**
 * One card per watched section code. The video is an `<iframe>` rather
 * than a `<video>` because the CIK stream URLs are served from a
 * different origin and a bare `<video src>` would break on CORS or on
 * any player UI wrapper; an iframe lets the upstream viewer handle its
 * own MIME and controls.
 *
 * Header: section code · address · live status. Flashes the border once
 * on every red-state transition so observers catch the event without the
 * UI looping an animation.
 */
export function LiveVideoCard({
  sectionCode,
  address,
  metric,
  streamUrl,
  onClose,
}: {
  sectionCode: string;
  address: LiveAddress | undefined;
  metric: LiveSectionMetric | undefined;
  streamUrl: string | undefined;
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

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-md border bg-card shadow-sm",
        flash ? "border-score-high" : "border-border",
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
              {sectionCode}
            </span>
            <LiveStatusBadge status={uiStatus} />
          </div>
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={address?.address}
          >
            {address?.address ?? "—"}
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

      <div className="relative aspect-video w-full bg-black">
        <VideoArea
          sectionCode={sectionCode}
          metric={metric}
          streamUrl={streamUrl}
        />
      </div>

      <div className="px-3 py-1.5">
        <Link
          to={`/section/${sectionCode}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <ChartBar size={12} />
          Минали резултати
        </Link>
      </div>
    </article>
  );
}

function VideoArea({
  sectionCode,
  metric,
  streamUrl,
}: {
  sectionCode: string;
  metric: LiveSectionMetric | undefined;
  streamUrl: string | undefined;
}) {
  if (streamUrl) {
    return (
      <iframe
        key={streamUrl}
        src={streamUrl}
        title={`Стрийм ${sectionCode}`}
        loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture"
        className="h-full w-full border-0"
      />
    );
  }

  if (metric?.snapshot_url) {
    return <SnapshotImage url={metric.snapshot_url} reportedAt={metric.reported_at} />;
  }

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

const STREAM_START_ISO = "2026-04-19T20:00:00+03:00";

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

