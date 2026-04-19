import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { X, ExternalLink, ChartBar, ChevronLeft } from "lucide-react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveSectionMetric } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { LiveStatusBadge, statusTone, type UiStatus } from "./live-status-badge.js";
import { LiveNearbyChips } from "./live-nearby-chips.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";

/**
 * One card per opened polling address. Two view modes:
 *   - Single section (either the address has one section, or the viewer
 *     drilled in): shows the video / snapshot / waiting message plus a
 *     back button to return to the picker.
 *   - Picker: a compact list of every section at this address, each with
 *     its own live status. Clicking a row switches to the single-section
 *     view for that code.
 *
 * The card always carries header (address, close), footer (past results
 * link), and nearby chips — so election-day context is never one click
 * away. Red-state transitions pulse the border once so observers notice.
 */
export function LiveAddressCard({
  address,
  metrics,
  streamBySection,
  allAddresses,
  openIds,
  liveCodes,
  onOpen,
  onClose,
}: {
  address: LiveAddress;
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  allAddresses: LiveAddress[];
  openIds: string[];
  liveCodes: Set<string>;
  onOpen: (addressId: string) => void;
  onClose: () => void;
}) {
  const single = address.section_codes.length === 1;
  // Picker shows on multi-section addresses until the user picks a code.
  const [activeCode, setActiveCode] = useState<string | null>(
    single ? address.section_codes[0] : null,
  );

  const activeMetric = activeCode ? metrics?.[activeCode] : undefined;
  const activeStream = activeCode ? streamBySection.get(activeCode) : undefined;
  const uiStatus: UiStatus | null = activeCode
    ? resolveStatus(activeMetric, activeStream)
    : null;
  const tone = uiStatus ? statusTone(uiStatus) : null;

  // Pulse-once on any transition into a red state.
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

  const reportedAgo = activeMetric?.reported_at
    ? secondsAgo(activeMetric.reported_at)
    : null;

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
            {!single && activeCode && (
              <button
                type="button"
                onClick={() => setActiveCode(null)}
                className="inline-flex items-center gap-0.5 rounded text-2xs font-medium uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Обратно към списъка със секции"
              >
                <ChevronLeft size={12} />
                секции
              </button>
            )}
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
              {activeCode ?? address.section_codes[0]}
            </span>
            {!single && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                {address.section_codes.length} секции
              </span>
            )}
            {uiStatus && <LiveStatusBadge status={uiStatus} />}
          </div>
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={address.address}
          >
            {address.address}
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

      {/* Body: picker or video */}
      {activeCode ? (
        <>
          <div className="relative aspect-video w-full bg-black">
            <VideoArea metric={activeMetric} streamUrl={activeStream} />
          </div>

          <div className="flex flex-col gap-2 px-3 py-2">
            {reportedAgo != null && (
              <p className="text-3xs uppercase tracking-eyebrow text-muted-foreground">
                обновено преди {reportedAgo} сек.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/section/${activeCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <ChartBar size={12} />
                Минали резултати
              </Link>
              {activeStream && (
                <a
                  href={activeStream}
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
        </>
      ) : (
        <SectionPicker
          address={address}
          metrics={metrics}
          streamBySection={streamBySection}
          onPick={setActiveCode}
        />
      )}

      <LiveNearbyChips
        target={address}
        allAddresses={allAddresses}
        metrics={metrics}
        liveCodes={liveCodes}
        openIds={openIds}
        onOpen={onOpen}
      />
    </article>
  );
}

function SectionPicker({
  address,
  metrics,
  streamBySection,
  onPick,
}: {
  address: LiveAddress;
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  onPick: (code: string) => void;
}) {
  return (
    <div className="flex flex-col px-3 py-2">
      <p className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
        {address.section_codes.length} секции на този адрес
      </p>
      <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border">
        {address.section_codes.map((code) => {
          const status = resolveStatus(metrics?.[code], streamBySection.get(code));
          return (
            <li key={code}>
              <button
                type="button"
                onClick={() => onPick(code)}
                className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left transition-colors hover:bg-secondary/50"
              >
                <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                  {code}
                </span>
                <div className="flex items-center gap-2">
                  <LiveStatusBadge status={status} />
                  <span className="text-score-high text-2xs font-medium uppercase tracking-eyebrow">
                    виж →
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VideoArea({
  metric,
  streamUrl,
}: {
  metric: LiveSectionMetric | undefined;
  streamUrl: string | undefined;
}) {
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

function secondsAgo(ts: number): number {
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}
