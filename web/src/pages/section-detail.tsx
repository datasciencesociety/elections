import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import type {
  PersistenceHistoryEntry as ElectionHistory,
  AnomalySection,
  SiblingSection,
} from "@/lib/api/types.js";
import { usePersistenceSectionHistory } from "@/lib/hooks/use-persistence.js";
import { useSectionSiblings, useSettlementPeers } from "@/lib/hooks/use-geography.js";
import { getAnomalies } from "@/lib/api/anomalies.js";
import {
  ScoreBadge,
  SCORE_HEX,
  SCORE_BORDER_LEFT_CLASS,
  scoreLevel,
} from "@/components/score/index.js";
import {
  SectionLocation,
  SectionElection,
} from "@/components/section/index.js";
import MethodologyExplainer from "@/components/methodology-explainer.js";
import { ShareButton } from "@/components/ui/share-button.js";
import AppFooter from "@/components/app-footer.js";

const REPORT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdLB0n9twfFQyiD4mIpAX_fYc_-N5bUhfkKpVJa6_-Oxv5CAQ/viewform";

/**
 * Standalone page for a single section across every election it appears in.
 *
 * Layout:
 *   - back link + report-problem button
 *   - editorial header (section code + flagged ratio chip)
 *   - <SectionLocation> — settlement / address / mini-map / suggest-location
 *   - stats strip (elections / avg / max / total violations)
 *   - score-over-time sparkline
 *   - breakdown table (one row per election with the per-methodology scores)
 *   - one <SectionElection compact> per election in the history
 *
 * Everything that's also shown in other surfaces (the location block, the
 * per-election protocol cards) comes from `components/section/`. The page
 * chrome (header, stats strip, sparkline, breakdown table) stays here
 * because it's specific to the cross-election overview.
 */
export default function SectionDetail() {
  const { sectionCode } = useParams<{ sectionCode: string }>();
  const [anomalyMeta, setAnomalyMeta] = useState<AnomalySection | null>(null);

  useEffect(() => {
    if (sectionCode) trackEvent("view_section_detail", { section_code: sectionCode });
  }, [sectionCode]);

  const { data: historyData, isLoading: loading } = usePersistenceSectionHistory(sectionCode);
  const history: ElectionHistory[] | null = historyData?.elections ?? null;
  const { data: siblingsData } = useSectionSiblings(sectionCode);
  const { data: peersData } = useSettlementPeers(sectionCode);

  // Server returns history sorted oldest → newest (chronological). The
  // sparkline reads that order (old on the left, new on the right) so we
  // keep `history` as-is for the timeline. Everything else — the breakdown
  // table, the per-election cards, and the anomaly-meta lookup — wants the
  // most recent first, so we derive `historyDesc`. Memoized so the array
  // reference stays stable across renders; otherwise the useEffect below
  // re-fires on every render and causes flicker.
  const historyDesc: ElectionHistory[] | null = useMemo(
    () => (history ? [...history].reverse() : null),
    [history],
  );

  // Pull location info from the most recent election that has a row in
  // section_scores. The same anomaly row is also passed as `initialAnomaly`
  // to the matching SectionElection so that one fewer query fires.
  useEffect(() => {
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
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Зареждане...
      </div>
    );
  }

  if (!history?.length || !sectionCode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className="text-sm text-muted-foreground">
          Няма данни за секция {sectionCode}
        </div>
        <Link
          to="/persistence"
          className="text-muted-foreground hover:text-foreground"
        >
          &larr; Назад
        </Link>
      </div>
    );
  }

  const flaggedCount = history.filter((h) => h.risk_score >= 0.3).length;
  const avgRisk = history.reduce((s, h) => s + h.risk_score, 0) / history.length;
  const maxRisk = Math.max(...history.map((h) => h.risk_score));
  const totalViolations = history.reduce(
    (s, h) => s + h.protocol_violation_count,
    0,
  );
  const flaggedPct = flaggedCount / history.length;
  const flaggedChipClass =
    flaggedPct >= 0.8
      ? "risk-bg-high"
      : flaggedPct >= 0.5
        ? "risk-bg-medium"
        : "risk-bg-low";

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        {/* Back + report problem */}
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/persistence"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; Системни
          </Link>
          <div className="flex items-center gap-2">
            <ShareButton
              url={`${window.location.origin}/section/${sectionCode}`}
              title={`Секция ${sectionCode}`}
            />
            <a
              href={`${REPORT_FORM_URL}?entry.1736983913=${encodeURIComponent(window.location.href)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:border-brand hover:text-score-high"
            >
              Докладвай разминаване
            </a>
          </div>
        </div>

        {/* Editorial header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              {sectionCode}
            </h1>
            <span
              className={`rounded-full px-3 py-0.5 text-xs font-semibold ${flaggedChipClass}`}
            >
              {flaggedCount}/{history.length} отбелязани
            </span>
          </div>
          <div className="mt-3 h-0.5 w-12 bg-brand" />
        </div>

        {/* Shared location block — header + map + suggest-location */}
        {anomalyMeta && (
          <div className="mb-6 rounded border border-border bg-card p-4">
            <SectionLocation
              electionId={anomalyMeta && historyDesc ? historyDesc[0].election_id : ""}
              sectionCode={sectionCode}
              settlementName={anomalyMeta.settlement_name}
              address={anomalyMeta.address}
              sectionType={anomalyMeta.section_type}
              lat={anomalyMeta.lat}
              lng={anomalyMeta.lng}
            />
          </div>
        )}

        {/* Per-election address history — shows when section moved */}
        {history && <AddressHistory history={history} />}

        {/* Sibling sections at the same address — peer check */}
        {siblingsData &&
          siblingsData.siblings.length >= 2 &&
          siblingsData.latest_election && (
            <SiblingsStrip
              currentCode={sectionCode}
              siblings={siblingsData.siblings}
              latestElectionName={siblingsData.latest_election.name}
            />
          )}

        {/* Peer turnout distribution — strip plot */}
        {peersData && peersData.peers.length >= 3 && (
          <PeerStripPlot
            peers={peersData.peers}
            currentCode={sectionCode}
            settlementName={peersData.settlement_name}
          />
        )}

        {/* Stats strip */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Избори" value={history.length} />
          <StatTile
            label="Ср. риск"
            valueNode={<ScoreBadge value={avgRisk} size="lg" />}
            accent={SCORE_HEX[scoreLevel(avgRisk)]}
          />
          <StatTile
            label="Макс. риск"
            valueNode={<ScoreBadge value={maxRisk} size="lg" />}
            accent={SCORE_HEX[scoreLevel(maxRisk)]}
          />
          <StatTile
            label="Нарушения"
            value={totalViolations}
            valueClass={totalViolations > 0 ? "risk-high" : ""}
            accent={totalViolations > 0 ? "#ce463c" : "transparent"}
          />
        </div>

        {/* Score-over-time sparkline */}
        <div className="mb-6 rounded border border-border bg-card p-4">
          <h2 className="mb-3 text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Риск през годините
          </h2>
          <div className="flex items-end gap-1">
            {history.map((h) => (
              <div
                key={h.election_id}
                className="group flex flex-1 flex-col items-center gap-0.5"
              >
                <span className="font-mono text-[9px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {h.risk_score.toFixed(2)}
                </span>
                <div
                  className="w-full rounded-t transition-all group-hover:opacity-80"
                  style={{
                    height: `${Math.max(8, h.risk_score * 96)}px`,
                    backgroundColor: SCORE_HEX[scoreLevel(h.risk_score)],
                  }}
                  title={`${h.election_name}: ${h.risk_score.toFixed(3)}`}
                />
                <span
                  className="max-w-full truncate text-[7px] leading-tight text-muted-foreground"
                  title={h.election_name}
                >
                  {h.election_date.slice(2, 7)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Methodology explainer — click to expand */}
        <MethodologyExplainer className="mb-6" />

        {/* Per-election score breakdown table */}
        <div className="mb-6 overflow-x-auto rounded border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Избори</th>
                <th className="px-2 py-2.5 text-left font-medium">Риск</th>
                <th className="hidden px-2 py-2.5 text-left font-medium sm:table-cell">
                  Бенфорд
                </th>
                <th className="hidden px-2 py-2.5 text-left font-medium sm:table-cell">
                  Сравнение
                </th>
                <th className="hidden px-2 py-2.5 text-left font-medium sm:table-cell">
                  АКФ
                </th>
                <th className="px-2 py-2.5 text-left font-medium">Активност</th>
                <th className="px-2 py-2.5 text-left font-medium">Проблеми</th>
              </tr>
            </thead>
            <tbody>
              {historyDesc!.map((h) => (
                <tr
                  key={h.election_id}
                  className="border-b border-border/50 transition-colors hover:bg-muted/30"
                >
                  <td className="px-3 py-2">
                    <span className="text-xs">{h.election_name}</span>
                  </td>
                  <td className="px-2 py-2">
                    <ScoreBadge value={h.risk_score} />
                  </td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <ScoreBadge value={h.benford_risk} />
                  </td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <ScoreBadge value={h.peer_risk} />
                  </td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <ScoreBadge value={h.acf_risk} />
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`font-mono tabular-nums ${h.turnout_rate > 1 ? "font-semibold risk-high" : ""}`}
                    >
                      {(h.turnout_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {h.protocol_violation_count > 0 && (
                        <span className="risk-bg-high rounded px-1 py-0.5 text-2xs">
                          Пр:{h.protocol_violation_count}
                        </span>
                      )}
                      {h.arithmetic_error === 1 && (
                        <span className="risk-bg-medium rounded px-1 py-0.5 text-2xs">
                          АГ
                        </span>
                      )}
                      {h.vote_sum_mismatch === 1 && (
                        <span className="risk-bg-medium rounded px-1 py-0.5 text-2xs">
                          НС
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Per-election cards — shared SectionElection in compact mode */}
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold">
            Протоколи по избори
          </h2>
          {historyDesc!.map((h) => (
            <div
              key={h.election_id}
              className={`rounded border border-border border-l-spine ${SCORE_BORDER_LEFT_CLASS[scoreLevel(h.risk_score)]} bg-card p-4`}
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
      <AppFooter />
    </div>
  );
}

/**
 * Horizontal strip of sibling sections at the same physical address.
 * Each chip shows turnout % and the winning party's share from the latest
 * election so a reader can eyeball peer divergence at a glance. Clicking a
 * chip navigates to that sibling's detail page.
 */
function SiblingsStrip({
  currentCode,
  siblings,
  latestElectionName,
}: {
  currentCode: string;
  siblings: SiblingSection[];
  latestElectionName: string;
}) {
  return (
    <div className="mb-6 rounded border border-border bg-card p-4">
      <h2 className="mb-3 text-2xs font-medium uppercase tracking-widest text-muted-foreground">
        Други секции на този адрес ({siblings.length}) · {latestElectionName}
      </h2>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:overflow-visible md:px-0">
        <div className="flex gap-2 md:grid md:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
          {siblings.map((s) => {
            const isCurrent = s.section_code === currentCode;
            const turnoutPct =
              s.turnout_rate != null ? (s.turnout_rate * 100).toFixed(1) : "—";
            const winnerPct =
              s.winner_pct != null ? s.winner_pct.toFixed(1) : "—";
            const chip = (
              <div
                className={`flex min-w-36 shrink-0 flex-col gap-1 rounded-lg border px-3 py-2 transition-all md:shrink ${
                  isCurrent
                    ? "border-brand bg-brand/5"
                    : "border-border bg-background hover:border-foreground/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                    {s.section_code}
                  </span>
                  {isCurrent && (
                    <span className="text-[9px] font-medium uppercase tracking-wider text-score-high">
                      Избрана
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: s.winner_color ?? "#999",
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {s.winner_party ?? "—"}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-foreground">
                    {winnerPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-2xs">
                  <span className="uppercase tracking-wider text-muted-foreground">
                    Активност
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {turnoutPct}%
                  </span>
                </div>
              </div>
            );
            return isCurrent ? (
              <div key={s.section_code}>{chip}</div>
            ) : (
              <Link
                key={s.section_code}
                to={`/section/${s.section_code}`}
                className="block"
              >
                {chip}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PeerStripPlot({
  peers,
  currentCode,
  settlementName,
}: {
  peers: { section_code: string; turnout_rate: number; risk_score: number }[];
  currentCode: string;
  settlementName: string;
}) {
  const turnouts = peers.map((p) => p.turnout_rate);
  const min = Math.min(...turnouts);
  const max = Math.max(...turnouts);
  const range = max - min || 0.01;
  const avg = turnouts.reduce((s, t) => s + t, 0) / turnouts.length;

  const W = 100;
  const xPct = (v: number) => ((v - min) / range) * W;

  const current = peers.find((p) => p.section_code === currentCode);

  return (
    <div className="mb-6 rounded border border-border bg-card p-4">
      <h2 className="mb-1 text-2xs font-medium uppercase tracking-widest text-muted-foreground">
        Активност спрямо населеното място
      </h2>
      <p className="mb-3 text-muted-foreground">
        {peers.length} секции в {settlementName}. Тази секция е маркирана.
      </p>
      <div className="relative h-8">
        {/* Track */}
        <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-border" />
        {/* Average marker */}
        <div
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-muted-foreground/40"
          style={{ left: `${xPct(avg)}%` }}
          title={`Средна: ${(avg * 100).toFixed(1)}%`}
        />
        {/* Peer dots */}
        {peers.map((p) => {
          const isCurrent = p.section_code === currentCode;
          return (
            <div
              key={p.section_code}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform ${
                isCurrent
                  ? "z-10 size-3.5 border-2 border-brand bg-brand"
                  : "size-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"
              }`}
              style={{ left: `${xPct(p.turnout_rate)}%` }}
              title={`${p.section_code}: ${(p.turnout_rate * 100).toFixed(1)}%`}
            />
          );
        })}
      </div>
      {/* Axis labels */}
      <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-muted-foreground">
        <span>{(min * 100).toFixed(0)}%</span>
        {current && (
          <span className="text-score-high font-semibold">
            {(current.turnout_rate * 100).toFixed(1)}%
          </span>
        )}
        <span>{(max * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/**
 * Shows per-election address/settlement when it changed across elections.
 * Hidden when all elections have the same address. For abroad sections this
 * reveals country reassignments (e.g. Turkey → Russia).
 */
function AddressHistory({ history }: { history: ElectionHistory[] }) {
  // Deduplicate: only show if settlement_name or address actually changed
  const uniqueSettlements = new Set(
    history.map((h) => h.settlement_name).filter(Boolean),
  );
  const uniqueAddresses = new Set(
    history.map((h) => h.address).filter(Boolean),
  );
  if (uniqueSettlements.size <= 1 && uniqueAddresses.size <= 1) return null;

  // Show newest first
  const desc = [...history].reverse();
  // Track previous values to highlight changes
  let prevSettlement: string | null = null;
  let prevAddress: string | null = null;

  return (
    <div className="mb-6 rounded border border-border bg-card p-4">
      <h2 className="mb-3 text-2xs font-medium uppercase tracking-widest text-muted-foreground">
        Адреси по избори
      </h2>
      <div className="space-y-1.5">
        {desc.map((h, i) => {
          const settlementChanged =
            prevSettlement !== null &&
            h.settlement_name !== null &&
            h.settlement_name !== prevSettlement;
          const addressChanged =
            prevAddress !== null &&
            h.address !== null &&
            h.address !== prevAddress;
          const changed = settlementChanged || addressChanged;
          prevSettlement = h.settlement_name;
          prevAddress = h.address;

          return (
            <div
              key={h.election_id}
              className={`flex items-start gap-3 rounded px-2.5 py-1.5 text-xs ${
                changed ? "bg-brand/10 border border-brand/20" : ""
              }`}
            >
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground w-20">
                {h.election_date.slice(0, 10)}
              </span>
              <div className="min-w-0 flex-1">
                <span className={changed ? "font-semibold text-score-high" : ""}>
                  {h.settlement_name ?? "—"}
                </span>
                {h.address && (
                  <span className="ml-2 text-muted-foreground truncate">
                    {h.address}
                  </span>
                )}
                {changed && i < desc.length - 1 && (
                  <span className="ml-2 text-2xs text-score-high">
                    различен адрес
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  valueNode,
  valueClass,
  accent,
}: {
  label: string;
  value?: number | string;
  valueNode?: React.ReactNode;
  valueClass?: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded border border-border bg-card p-3"
      style={
        accent
          ? { borderTopColor: accent, borderTopWidth: 2 }
          : undefined
      }
    >
      <div className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">
        {valueNode ?? (
          <span
            className={`font-display text-2xl font-semibold tabular-nums ${valueClass ?? ""}`}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
