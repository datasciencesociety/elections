import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map as MapGL, MapMarker, MarkerContent, MapControls } from "@/components/ui/map";

interface ElectionHistory {
  election_id: number;
  election_name: string;
  election_date: string;
  election_type: string;
  risk_score: number;
  benford_risk: number;
  peer_risk: number;
  acf_risk: number;
  turnout_rate: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  protocol_violation_count: number;
  protocol_url: string | null;
}

interface SectionLocation {
  settlement_name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

interface ElectionDetail {
  election_id: number;
  election_name: string;
  election_date: string;
  protocol: {
    registered_voters: number;
    actual_voters: number;
    received_ballots: number;
    added_voters: number;
    invalid_votes: number;
    null_votes: number;
    valid_votes: number;
    machine_count: number;
  };
  parties: {
    name: string;
    short_name: string;
    color: string;
    votes: number;
    paper: number;
    machine: number;
    pct: number;
  }[];
  violations: {
    rule_id: string;
    description: string;
    expected_value: string;
    actual_value: string;
    severity: string;
  }[];
}

function RiskBadge({ value }: { value: number }) {
  const bg =
    value >= 0.6
      ? "bg-red-100 text-red-800"
      : value >= 0.3
        ? "bg-orange-100 text-orange-800"
        : "bg-green-100 text-green-800";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums ${bg}`}>
      {value.toFixed(2)}
    </span>
  );
}

function riskBg(score: number): string {
  if (score >= 0.6) return "bg-red-500";
  if (score >= 0.3) return "bg-amber-400";
  return "bg-green-500";
}

function riskBorder(score: number): string {
  if (score >= 0.6) return "border-l-red-500";
  if (score >= 0.3) return "border-l-amber-400";
  return "border-l-green-500";
}

const METHODOLOGY_INFO: Record<string, { label: string; description: string }> = {
  benford: { label: "Бенфорд", description: "Анализ по закона на Бенфорд — разпределението на първите цифри на гласовете. Отклонение от естественото разпределение е индикатор за манипулация." },
  peer: { label: "Сравнение", description: "Сравнение с подобни секции в същото населено място. Голямо отклонение на резултатите показва аномалия." },
  acf: { label: "АКФ", description: "Анализ на комбинирани фактори — активност, победител, невалидни бюлетини. Повече аномални фактори = по-висок риск." },
};

function MethodologyScore({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="group relative flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <RiskBadge value={value} />
      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-56 rounded-md border border-border bg-background p-2 text-[10px] text-muted-foreground shadow-lg group-hover:block">
        {description}
      </div>
    </div>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PartyBar({ parties }: { parties: ElectionDetail["parties"] }) {
  const top = parties.slice(0, 5);
  const totalVotes = parties.reduce((s, p) => s + p.votes, 0);
  if (!totalVotes) return null;

  return (
    <div className="space-y-0.5">
      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {top.map((p, i) => (
          <div
            key={i}
            style={{ width: `${p.pct}%`, backgroundColor: p.color || "#ccc" }}
            title={`${p.short_name}: ${p.pct.toFixed(1)}%`}
            className="transition-opacity hover:opacity-80"
          />
        ))}
      </div>
      {/* Labels */}
      <div className="flex flex-wrap gap-x-3 gap-y-0">
        {top.map((p, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px]">
            <div className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: p.color || "#ccc" }} />
            <span className="truncate">{p.short_name}</span>
            <span className="font-mono tabular-nums text-muted-foreground">{p.votes}</span>
            <span className="font-mono tabular-nums text-muted-foreground">({p.pct.toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ElectionCard({ detail, history }: { detail: ElectionDetail; history: ElectionHistory }) {
  const p = detail.protocol;
  const turnout = p.registered_voters > 0 ? (p.actual_voters / p.registered_voters) * 100 : 0;

  return (
    <div className={`rounded-lg border border-border border-l-[3px] ${riskBorder(history.risk_score)} bg-background`}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <div className="flex-1">
          <h3 className="text-xs font-semibold">{detail.election_name}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <RiskBadge value={history.risk_score} />
          {history.protocol_violation_count > 0 && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
              {history.protocol_violation_count} нарушения
            </span>
          )}
          {history.arithmetic_error === 1 && (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">АГ</span>
          )}
        </div>
      </div>

      {/* Two-column: protocol + parties */}
      <div className="grid gap-0 border-t border-border/50 md:grid-cols-[1fr_1fr]">
        {/* Left: protocol data + methodology scores */}
        <div className="border-b border-border/50 px-4 py-2 md:border-b-0 md:border-r">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
            <div><span className="text-muted-foreground">Записани</span> <span className="font-mono tabular-nums">{p.registered_voters.toLocaleString()}</span></div>
            <div><span className="text-muted-foreground">Гласували</span> <span className="font-mono tabular-nums">{p.actual_voters.toLocaleString()}</span></div>
            <div>
              <span className="text-muted-foreground">Активност</span>{" "}
              <span className={`font-mono font-semibold tabular-nums ${turnout > 100 ? "text-red-600" : ""}`}>{turnout.toFixed(1)}%</span>
            </div>
            <div><span className="text-muted-foreground">Дописани</span> <span className="font-mono tabular-nums">{p.added_voters}</span></div>
          </div>
          {/* Methodology scores */}
          <div className="mt-2 flex flex-wrap gap-2">
            <MethodologyScore label="Бенфорд" value={history.benford_risk} description={METHODOLOGY_INFO.benford.description} />
            <MethodologyScore label="Сравнение" value={history.peer_risk} description={METHODOLOGY_INFO.peer.description} />
            <MethodologyScore label="АКФ" value={history.acf_risk} description={METHODOLOGY_INFO.acf.description} />
          </div>
        </div>

        {/* Right: party results (always visible) */}
        <div className="px-4 py-2">
          <PartyBar parties={detail.parties} />
        </div>
      </div>

      {/* Violations */}
      {detail.violations.length > 0 && (
        <div className="space-y-0.5 border-t border-border/50 px-4 py-2">
          {detail.violations.map((v, i) => (
            <div key={i} className={`rounded px-2 py-0.5 text-[10px] ${v.severity === "error" ? "bg-red-50 text-red-800" : "bg-yellow-50 text-yellow-800"}`}>
              <span className="font-medium">{v.rule_id}</span> {v.description}
              <span className="ml-1 opacity-70">({v.actual_value} вм. {v.expected_value})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SectionDetail() {
  const { sectionCode } = useParams<{ sectionCode: string }>();
  const [history, setHistory] = useState<ElectionHistory[] | null>(null);
  const [location, setLocation] = useState<SectionLocation | null>(null);
  const [details, setDetails] = useState<Map<number, ElectionDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!sectionCode) return;
    trackEvent("view_section_detail", { section_code: sectionCode });
    fetch(`/api/elections/persistence/${sectionCode}`)
      .then((r) => r.json())
      .then((d: { elections: ElectionHistory[] }) => setHistory(d.elections))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [sectionCode]);

  useEffect(() => {
    if (!history?.length || !sectionCode) return;
    setLoadingDetails(true);

    const fetches = history.map((h) =>
      Promise.all([
        fetch(`/api/elections/${h.election_id}/sections/${sectionCode}`).then((r) => r.ok ? r.json() : null),
        fetch(`/api/elections/${h.election_id}/violations/${sectionCode}`).then((r) => r.ok ? r.json() : { violations: [] }),
      ]).then(([sectionData, violationData]) => {
        if (!sectionData) return null;
        return {
          election_id: h.election_id,
          election_name: h.election_name,
          election_date: h.election_date,
          protocol: sectionData.protocol,
          parties: sectionData.parties,
          violations: violationData.violations ?? [],
        } as ElectionDetail;
      }),
    );

    Promise.all(fetches).then((results) => {
      const map = new Map<number, ElectionDetail>();
      for (const r of results) {
        if (r) map.set(r.election_id, r);
      }
      setDetails(map);

      const firstWithContext = results.find((r) => r);
      if (firstWithContext) {
        fetch(`/api/elections/${firstWithContext.election_id}/anomalies?section=${sectionCode}&min_risk=0&limit=1`)
          .then((r) => r.json())
          .then((d) => {
            const sec = d.sections?.[0];
            if (sec) {
              setLocation({
                settlement_name: sec.settlement_name,
                address: sec.address,
                lat: sec.lat,
                lng: sec.lng,
              });
            }
          })
          .catch(() => {});
      }
      setLoadingDetails(false);
    });
  }, [history, sectionCode]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Зареждане...</div>;
  }

  if (!history?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className="text-sm text-muted-foreground">Няма данни за секция {sectionCode}</div>
        <Link to="/persistence" className="text-xs text-muted-foreground hover:text-foreground">← Назад</Link>
      </div>
    );
  }

  const flaggedCount = history.filter((h) => h.risk_score >= 0.3).length;
  const avgRisk = history.reduce((s, h) => s + h.risk_score, 0) / history.length;
  const maxRisk = Math.max(...history.map((h) => h.risk_score));
  const totalViolations = history.reduce((s, h) => s + h.protocol_violation_count, 0);
  const hasCoords = location?.lat != null && location?.lng != null;

  return (
    <div className="h-full overflow-auto bg-secondary/30">
      <div className="mx-auto max-w-6xl px-3 py-4 md:px-6 md:py-6">
        {/* Back link */}
        <Link to="/persistence" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          ← Системни
        </Link>

        {/* Header */}
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <h1 className="text-base font-bold tracking-tight md:text-lg">Секция {sectionCode}</h1>
            {location && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {location.settlement_name}
                {location.address && <span> — {location.address}</span>}
              </div>
            )}
          </div>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
            flaggedCount / history.length >= 0.8 ? "bg-red-100 text-red-800"
              : flaggedCount / history.length >= 0.5 ? "bg-orange-100 text-orange-800"
                : "bg-green-100 text-green-800"
          }`}>
            {flaggedCount}/{history.length} флагнати
          </div>
        </div>

        {/* Map + Stats side by side */}
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr]">
          {/* Map — large */}
          {hasCoords ? (
            <div className="h-72 overflow-hidden rounded-lg border border-border md:h-80">
              <MapGL viewport={{ center: [location!.lng!, location!.lat!], zoom: 15, bearing: 0, pitch: 0 }}>
                <MapMarker latitude={location!.lat!} longitude={location!.lng!}>
                  <MarkerContent>
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-red-500 shadow-lg">
                      <div className="h-2.5 w-2.5 rounded-full bg-white" />
                    </div>
                  </MarkerContent>
                </MapMarker>
                <MapControls position="bottom-right" showZoom showCompass={false} />
              </MapGL>
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center rounded-lg border border-border bg-muted/50 text-xs text-muted-foreground md:h-80">
              Няма координати
            </div>
          )}

          {/* Stats panel */}
          <div className="flex flex-col gap-3">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Избори">
                <span className="text-xl font-bold tabular-nums">{history.length}</span>
              </StatCard>
              <StatCard label="Ср. риск">
                <RiskBadge value={avgRisk} />
              </StatCard>
              <StatCard label="Макс. риск">
                <RiskBadge value={maxRisk} />
              </StatCard>
              <StatCard label="Нарушения">
                <span className={`text-xl font-bold tabular-nums ${totalViolations > 0 ? "text-red-600" : ""}`}>
                  {totalViolations}
                </span>
              </StatCard>
            </div>

            {/* Risk timeline bar chart */}
            <div className="flex-1 rounded-lg border border-border bg-background p-3">
              <h2 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Риск през годините</h2>
              <div className="flex items-end gap-0.5">
                {history.map((h) => (
                  <div key={h.election_id} className="group flex flex-1 flex-col items-center gap-0.5">
                    <span className="text-[8px] font-mono tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {h.risk_score.toFixed(2)}
                    </span>
                    <div
                      className={`w-full rounded-t transition-all group-hover:opacity-80 ${riskBg(h.risk_score)}`}
                      style={{ height: `${Math.max(4, h.risk_score * 64)}px` }}
                      title={`${h.election_name}: ${h.risk_score.toFixed(3)}`}
                    />
                    <span className="max-w-full truncate text-[7px] leading-tight text-muted-foreground" title={h.election_name}>
                      {h.election_date.slice(2, 7)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-red-500" /> &ge; 0.6</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-400" /> 0.3–0.6</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-green-500" /> &lt; 0.3</span>
              </div>
            </div>
          </div>
        </div>

        {/* Methodology explanations */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {Object.entries(METHODOLOGY_INFO).map(([key, info]) => (
            <div key={key} className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-[11px] font-semibold">{info.label}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{info.description}</div>
            </div>
          ))}
        </div>

        {/* Risk breakdown table */}
        <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/50 text-[10px] text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Избори</th>
                <th className="px-2 py-2 text-left font-medium">Риск</th>
                <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">Бенфорд</th>
                <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">Сравнение</th>
                <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">АКФ</th>
                <th className="px-2 py-2 text-left font-medium">Активност</th>
                <th className="px-2 py-2 text-left font-medium">Проблеми</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.election_id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                  <td className="px-3 py-1.5">
                    <div className="text-xs font-medium">{h.election_name}</div>
                  </td>
                  <td className="px-2 py-1.5"><RiskBadge value={h.risk_score} /></td>
                  <td className="hidden px-2 py-1.5 sm:table-cell"><RiskBadge value={h.benford_risk} /></td>
                  <td className="hidden px-2 py-1.5 sm:table-cell"><RiskBadge value={h.peer_risk} /></td>
                  <td className="hidden px-2 py-1.5 sm:table-cell"><RiskBadge value={h.acf_risk} /></td>
                  <td className="px-2 py-1.5">
                    <span className={`font-mono tabular-nums ${h.turnout_rate > 1 ? "font-bold text-red-600" : ""}`}>
                      {(h.turnout_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1">
                      {h.protocol_violation_count > 0 && (
                        <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-800">Пр:{h.protocol_violation_count}</span>
                      )}
                      {h.arithmetic_error === 1 && (
                        <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-800">АГ</span>
                      )}
                      {h.vote_sum_mismatch === 1 && (
                        <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-800">НС</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Per-election protocol cards with inline parties */}
        {loadingDetails && (
          <div className="py-6 text-center text-xs text-muted-foreground">Зареждане на протоколи...</div>
        )}

        {details.size > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold">Протоколи по избори</h2>
            {history.map((h) => {
              const detail = details.get(h.election_id);
              if (!detail) return null;
              return <ElectionCard key={h.election_id} detail={detail} history={h} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
