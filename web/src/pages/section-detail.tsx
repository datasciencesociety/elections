import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map as MapGL, MapMarker, MarkerContent, MapControls } from "@/components/ui/map";
import BallotList from "@/components/ballot-list";

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

function riskClass(score: number): string {
  if (score >= 0.6) return "risk-bg-high";
  if (score >= 0.3) return "risk-bg-medium";
  return "risk-bg-low";
}

function riskColor(score: number): string {
  if (score >= 0.6) return "#ce463c";
  if (score >= 0.3) return "#c4860b";
  return "#2d8a4e";
}

function RiskBadge({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const cls = riskClass(value);
  const sizeClass = size === "lg" ? "text-sm px-2 py-0.5" : "text-[11px] px-1.5 py-0.5";
  return (
    <span className={`inline-block rounded font-mono font-semibold tabular-nums ${cls} ${sizeClass}`}>
      {value.toFixed(2)}
    </span>
  );
}

function riskBorder(score: number): string {
  if (score >= 0.6) return "border-l-[#ce463c]";
  if (score >= 0.3) return "border-l-[#c4860b]";
  return "border-l-[#2d8a4e]";
}

const METHODOLOGY_DESC: Record<string, string> = {
  benford: "Анализ по закона на Бенфорд — разпределението на първите цифри на гласовете.",
  peer: "Сравнение с подобни секции в същото населено място.",
  acf: "Комбинирани фактори — активност, победител, невалидни бюлетини.",
};

function MethodologyScore({ label, value, descKey }: { label: string; value: number; descKey: string }) {
  return (
    <div className="group relative flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <RiskBadge value={value} />
      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-52 rounded border border-border bg-card p-2 text-[10px] text-muted-foreground shadow-md group-hover:block">
        {METHODOLOGY_DESC[descKey]}
      </div>
    </div>
  );
}

function ElectionCard({ detail, history }: { detail: ElectionDetail; history: ElectionHistory }) {
  const p = detail.protocol;
  const turnout = p.registered_voters > 0 ? (p.actual_voters / p.registered_voters) * 100 : 0;

  return (
    <div className={`rounded border border-border border-l-[3px] ${riskBorder(history.risk_score)} bg-card`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <h3 className="flex-1 font-display text-sm font-semibold">{detail.election_name}</h3>
        <div className="flex items-center gap-1.5">
          <RiskBadge value={history.risk_score} />
          {history.protocol_violation_count > 0 && (
            <span className="risk-bg-high rounded px-1.5 py-0.5 text-[10px] font-medium">
              {history.protocol_violation_count} нарушения
            </span>
          )}
          {history.arithmetic_error === 1 && (
            <span className="risk-bg-medium rounded px-1.5 py-0.5 text-[10px] font-medium">АГ</span>
          )}
        </div>
      </div>

      <div className="grid gap-0 border-t border-border/50 md:grid-cols-[1fr_1fr]">
        <div className="border-b border-border/50 px-4 py-2 md:border-b-0 md:border-r">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
            <div><span className="text-muted-foreground">Записани</span> <span className="font-mono tabular-nums">{p.registered_voters.toLocaleString()}</span></div>
            <div><span className="text-muted-foreground">Гласували</span> <span className="font-mono tabular-nums">{p.actual_voters.toLocaleString()}</span></div>
            <div>
              <span className="text-muted-foreground">Активност</span>{" "}
              <span className={`font-mono font-semibold tabular-nums ${turnout > 100 ? "risk-high" : ""}`}>{turnout.toFixed(1)}%</span>
            </div>
            <div><span className="text-muted-foreground">Дописани</span> <span className="font-mono tabular-nums">{p.added_voters}</span></div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <MethodologyScore label="Б" value={history.benford_risk} descKey="benford" />
            <MethodologyScore label="С" value={history.peer_risk} descKey="peer" />
            <MethodologyScore label="А" value={history.acf_risk} descKey="acf" />
          </div>
        </div>
        <div className="px-4 py-2">
          <BallotList entries={detail.parties} variant="stacked-bar" density="md" />
        </div>
      </div>

      {detail.violations.length > 0 && (
        <div className="space-y-0.5 border-t border-border/50 px-4 py-2">
          {detail.violations.map((v, i) => (
            <div key={i} className={`rounded px-2 py-0.5 text-[10px] ${v.severity === "error" ? "risk-bg-high" : "risk-bg-medium"}`}>
              <span className="font-medium">{v.rule_id}</span> {v.description}
              <span className="ml-1 opacity-70">({v.actual_value} вм. {v.expected_value})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const REPORT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdLB0n9twfFQyiD4mIpAX_fYc_-N5bUhfkKpVJa6_-Oxv5CAQ/viewform";

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
        <Link to="/persistence" className="text-xs text-muted-foreground hover:text-foreground">&larr; Назад</Link>
      </div>
    );
  }

  const flaggedCount = history.filter((h) => h.risk_score >= 0.3).length;
  const avgRisk = history.reduce((s, h) => s + h.risk_score, 0) / history.length;
  const maxRisk = Math.max(...history.map((h) => h.risk_score));
  const totalViolations = history.reduce((s, h) => s + h.protocol_violation_count, 0);
  const hasCoords = location?.lat != null && location?.lng != null;
  const flaggedPct = flaggedCount / history.length;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        {/* Back + actions */}
        <div className="mb-4 flex items-center justify-between">
          <Link to="/persistence" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            &larr; Системни
          </Link>
          <a
            href={`${REPORT_FORM_URL}?entry.1736983913=${encodeURIComponent(window.location.href)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#ce463c] hover:text-[#ce463c]"
          >
            Докладвай проблем
          </a>
        </div>

        {/* Header — editorial */}
        <div className="mb-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              {sectionCode}
            </h1>
            <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
              flaggedPct >= 0.8 ? "risk-bg-high" : flaggedPct >= 0.5 ? "risk-bg-medium" : "risk-bg-low"
            }`}>
              {flaggedCount}/{history.length} флагнати
            </span>
          </div>
          {location && (
            <p className="mt-1 text-sm text-muted-foreground">
              {location.settlement_name}
              {location.address && <span className="ml-1">&mdash; {location.address}</span>}
            </p>
          )}
          {/* Thin brand accent line */}
          <div className="mt-3 h-0.5 w-12 bg-[#ce463c]" />
        </div>

        {/* Stats strip */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border border-border bg-card p-3">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Избори</div>
            <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{history.length}</div>
          </div>
          <div className="rounded border border-border bg-card p-3" style={{ borderTopColor: riskColor(avgRisk), borderTopWidth: 2 }}>
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Ср. риск</div>
            <div className="mt-1"><RiskBadge value={avgRisk} size="lg" /></div>
          </div>
          <div className="rounded border border-border bg-card p-3" style={{ borderTopColor: riskColor(maxRisk), borderTopWidth: 2 }}>
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Макс. риск</div>
            <div className="mt-1"><RiskBadge value={maxRisk} size="lg" /></div>
          </div>
          <div className="rounded border border-border bg-card p-3" style={{ borderTopColor: totalViolations > 0 ? "#ce463c" : "transparent", borderTopWidth: 2 }}>
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Нарушения</div>
            <div className={`mt-1 font-display text-2xl font-semibold tabular-nums ${totalViolations > 0 ? "risk-high" : ""}`}>
              {totalViolations}
            </div>
          </div>
        </div>

        {/* Map + Timeline */}
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_1fr]">
          {hasCoords ? (
            <div className="h-56 overflow-hidden rounded border border-border md:h-64">
              <MapGL viewport={{ center: [location!.lng!, location!.lat!], zoom: 15, bearing: 0, pitch: 0 }}>
                <MapMarker latitude={location!.lat!} longitude={location!.lng!}>
                  <MarkerContent>
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#ce463c] shadow-md">
                      <div className="h-2 w-2 rounded-full bg-white" />
                    </div>
                  </MarkerContent>
                </MapMarker>
                <MapControls position="bottom-right" showZoom showCompass={false} />
              </MapGL>
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center rounded border border-border bg-muted/30 text-xs text-muted-foreground md:h-64">
              Няма координати
            </div>
          )}

          <div className="flex flex-col rounded border border-border bg-card p-4">
            <h2 className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Риск през годините</h2>
            <div className="flex flex-1 items-end gap-1">
              {history.map((h) => (
                <div key={h.election_id} className="group flex flex-1 flex-col items-center gap-0.5">
                  <span className="font-mono text-[9px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {h.risk_score.toFixed(2)}
                  </span>
                  <div
                    className="w-full rounded-t transition-all group-hover:opacity-80"
                    style={{
                      height: `${Math.max(8, h.risk_score * 96)}px`,
                      backgroundColor: riskColor(h.risk_score),
                    }}
                    title={`${h.election_name}: ${h.risk_score.toFixed(3)}`}
                  />
                  <span className="max-w-full truncate text-[7px] leading-tight text-muted-foreground" title={h.election_name}>
                    {h.election_date.slice(2, 7)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#ce463c]" /> &ge; 0.6</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c4860b]" /> 0.3–0.6</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2d8a4e]" /> &lt; 0.3</span>
            </div>
          </div>
        </div>

        {/* Risk breakdown table */}
        <div className="mb-6 overflow-x-auto rounded border border-border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Избори</th>
                <th className="px-2 py-2.5 text-left font-medium">Риск</th>
                <th className="hidden px-2 py-2.5 text-left font-medium sm:table-cell">Бенфорд</th>
                <th className="hidden px-2 py-2.5 text-left font-medium sm:table-cell">Сравнение</th>
                <th className="hidden px-2 py-2.5 text-left font-medium sm:table-cell">АКФ</th>
                <th className="px-2 py-2.5 text-left font-medium">Активност</th>
                <th className="px-2 py-2.5 text-left font-medium">Проблеми</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.election_id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span className="text-xs">{h.election_name}</span>
                  </td>
                  <td className="px-2 py-2"><RiskBadge value={h.risk_score} /></td>
                  <td className="hidden px-2 py-2 sm:table-cell"><RiskBadge value={h.benford_risk} /></td>
                  <td className="hidden px-2 py-2 sm:table-cell"><RiskBadge value={h.peer_risk} /></td>
                  <td className="hidden px-2 py-2 sm:table-cell"><RiskBadge value={h.acf_risk} /></td>
                  <td className="px-2 py-2">
                    <span className={`font-mono tabular-nums ${h.turnout_rate > 1 ? "font-semibold risk-high" : ""}`}>
                      {(h.turnout_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {h.protocol_violation_count > 0 && (
                        <span className="risk-bg-high rounded px-1 py-0.5 text-[10px]">Пр:{h.protocol_violation_count}</span>
                      )}
                      {h.arithmetic_error === 1 && (
                        <span className="risk-bg-medium rounded px-1 py-0.5 text-[10px]">АГ</span>
                      )}
                      {h.vote_sum_mismatch === 1 && (
                        <span className="risk-bg-medium rounded px-1 py-0.5 text-[10px]">НС</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Per-election protocol cards */}
        {loadingDetails && (
          <div className="py-6 text-center text-xs text-muted-foreground">Зареждане на протоколи...</div>
        )}

        {details.size > 0 && (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Протоколи по избори</h2>
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
