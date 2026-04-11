import { useEffect, useMemo, useState } from "react";
import type {
  PersistenceHistoryEntry as ElectionHistory,
  AnomalySection,
} from "@/lib/api/types.js";
import { usePersistenceSectionHistory } from "@/lib/hooks/use-persistence.js";
import { getAnomalies } from "@/lib/api/anomalies.js";
import {
  ScoreBadge,
  SCORE_SOLID_CLASS,
  SCORE_BORDER_LEFT_CLASS,
  scoreLevel,
} from "@/components/score/index.js";
import {
  SectionLocation,
  SectionElection,
} from "@/components/section/index.js";

/**
 * Compact "section across elections" popover used by the persistence page.
 * Same idea as the standalone `pages/section-detail.tsx` but inline and
 * smaller.
 *
 * Layout:
 *   - <SectionLocation> — settlement / address / mini-map / suggest-location
 *   - 4-up summary stats
 *   - score sparkline
 *   - "open page" + "share" actions
 *   - one <SectionElection compact> per election in the history
 *
 * The shared `SectionLocation` block replaces what used to be a hand-rolled
 * mini-map + location text + correction button. The shared `SectionElection`
 * replaces the old `ElectionCard`.
 */
export default function SectionPreview({
  sectionCode,
}: {
  sectionCode: string;
}) {
  const [anomalyMeta, setAnomalyMeta] = useState<AnomalySection | null>(null);

  const { data: historyData, isLoading: loading } =
    usePersistenceSectionHistory(sectionCode);
  const history: ElectionHistory[] | null = historyData?.elections ?? null;

  // Server returns oldest→newest for the sparkline's benefit. Everything
  // else (the per-election cards below, the anomaly-meta lookup for the
  // location block) wants newest-first, so derive historyDesc once.
  // Memoized so the array reference is stable across renders — otherwise
  // the useEffect below fires on every render and causes flicker.
  const historyDesc: ElectionHistory[] | null = useMemo(
    () => (history ? [...history].reverse() : null),
    [history],
  );

  // Pull location info from the most recent election in the history.
  useEffect(() => {
    setAnomalyMeta(null);
    if (!sectionCode || !historyDesc?.length) return;
    const latest = historyDesc[0];
    let cancelled = false;
    getAnomalies({
      electionId: latest.election_id,
      minRisk: 0,
      limit: 1,
      section: sectionCode,
    })
      .then((d) => {
        if (cancelled) return;
        const sec = d.sections?.[0];
        if (sec) setAnomalyMeta(sec);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [historyDesc, sectionCode]);

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Зареждане...
      </div>
    );
  }

  if (!history?.length) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Няма данни
      </div>
    );
  }

  const flaggedCount = history.filter((h) => h.risk_score >= 0.3).length;
  const avgRisk =
    history.reduce((s, h) => s + h.risk_score, 0) / history.length;
  const maxRisk = Math.max(...history.map((h) => h.risk_score));

  return (
    <div className="space-y-3">
      {/* Shared location block: header, mini-map, suggest-location */}
      {anomalyMeta && historyDesc && (
        <SectionLocation
          electionId={historyDesc[0].election_id}
          sectionCode={sectionCode}
          settlementName={anomalyMeta.settlement_name}
          address={anomalyMeta.address}
          sectionType={anomalyMeta.section_type}
          lat={anomalyMeta.lat}
          lng={anomalyMeta.lng}
        />
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Избори" value={history.length} />
        <Stat
          label="Отбелязани"
          value={
            <>
              {flaggedCount}
              <span className="text-xs font-normal text-muted-foreground">
                /{history.length}
              </span>
            </>
          }
        />
        <Stat label="Ср. риск" value={<ScoreBadge value={avgRisk} />} />
        <Stat label="Макс." value={<ScoreBadge value={maxRisk} />} />
      </div>

      {/* Score sparkline */}
      <div className="rounded-lg border border-border bg-background p-2.5">
        <div className="flex items-end gap-0.5">
          {history.map((h) => (
            <div
              key={h.election_id}
              className="group flex flex-1 flex-col items-center gap-0.5"
            >
              <span className="text-[7px] font-mono tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                {h.risk_score.toFixed(2)}
              </span>
              <div
                className={`w-full rounded-t ${SCORE_SOLID_CLASS[scoreLevel(h.risk_score)]}`}
                style={{ height: `${Math.max(3, h.risk_score * 48)}px` }}
                title={`${h.election_name}: ${h.risk_score.toFixed(3)}`}
              />
              <span className="max-w-full truncate text-[6px] leading-tight text-muted-foreground">
                {h.election_date.slice(2, 7)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Open page + share */}
      <div className="flex gap-2">
        <a
          href={`/section/${sectionCode}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-center text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Отвори ↗
        </a>
        <button
          onClick={() => {
            const url = `${window.location.origin}/section/${sectionCode}`;
            if (navigator.share) {
              navigator.share({ title: `Секция ${sectionCode}`, url });
            } else {
              navigator.clipboard.writeText(url);
            }
          }}
          className="flex-1 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-center text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {"share" in navigator ? "Сподели" : "Копирай линк"}
        </button>
      </div>

      {/* Per-election cards — newest first */}
      <div className="space-y-2">
        {historyDesc!.map((h) => (
          <div
            key={h.election_id}
            className={`rounded-lg border border-border border-l-[3px] ${SCORE_BORDER_LEFT_CLASS[scoreLevel(h.risk_score)]} bg-background p-3`}
          >
            <SectionElection
              electionId={h.election_id}
              sectionCode={sectionCode}
              electionName={h.election_name}
              compact
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-2 text-center">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
