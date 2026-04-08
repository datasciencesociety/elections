import { useEffect, useState } from "react";
import { Map as MapGL, MapMarker, MarkerContent, MapControls } from "@/components/ui/map";
import LocationCorrection from "@/components/location-correction";

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

function PartyBar({ parties }: { parties: ElectionDetail["parties"] }) {
  const top = parties.slice(0, 5);
  const totalVotes = parties.reduce((s, p) => s + p.votes, 0);
  if (!totalVotes) return null;

  return (
    <div className="space-y-0.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {top.map((p, i) => (
          <div
            key={i}
            style={{ width: `${p.pct}%`, backgroundColor: p.color || "#ccc" }}
            title={`${p.short_name}: ${p.pct.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0">
        {top.map((p, i) => (
          <div key={i} className="flex items-center gap-0.5 text-[9px]">
            <div className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color || "#ccc" }} />
            <span className="truncate">{p.short_name}</span>
            <span className="font-mono tabular-nums text-muted-foreground">{p.pct.toFixed(0)}%</span>
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
      <div className="flex items-center gap-2 px-3 py-1.5">
        <h3 className="flex-1 text-[11px] font-semibold">{detail.election_name}</h3>
        {history.protocol_url && (
          <a
            href={history.protocol_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
          >
            Протокол ↗
          </a>
        )}
        <RiskBadge value={history.risk_score} />
        {history.protocol_violation_count > 0 && (
          <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-medium text-red-800">
            {history.protocol_violation_count} нар.
          </span>
        )}
      </div>

      {/* Content */}
      <div className="border-t border-border/50 px-3 py-1.5">
        {/* Protocol row */}
        <div className="flex flex-wrap gap-x-3 gap-y-0 text-[10px]">
          <span><span className="text-muted-foreground">Зап.</span> <span className="font-mono tabular-nums">{p.registered_voters}</span></span>
          <span><span className="text-muted-foreground">Глас.</span> <span className="font-mono tabular-nums">{p.actual_voters}</span></span>
          <span>
            <span className="text-muted-foreground">Акт.</span>{" "}
            <span className={`font-mono font-semibold tabular-nums ${turnout > 100 ? "text-red-600" : ""}`}>{turnout.toFixed(1)}%</span>
          </span>
          {p.added_voters > 0 && (
            <span><span className="text-muted-foreground">Доп.</span> <span className="font-mono tabular-nums">{p.added_voters}</span></span>
          )}
        </div>

        {/* Methodology scores */}
        <div className="mt-1 flex gap-1.5">
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">Б <RiskBadge value={history.benford_risk} /></span>
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">С <RiskBadge value={history.peer_risk} /></span>
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">А <RiskBadge value={history.acf_risk} /></span>
        </div>

        {/* Party bar */}
        <div className="mt-1.5">
          <PartyBar parties={detail.parties} />
        </div>
      </div>

      {/* Violations */}
      {detail.violations.length > 0 && (
        <div className="space-y-0.5 border-t border-border/50 px-3 py-1">
          {detail.violations.map((v, i) => (
            <div key={i} className={`rounded px-1.5 py-0.5 text-[9px] ${v.severity === "error" ? "bg-red-50 text-red-800" : "bg-yellow-50 text-yellow-800"}`}>
              <span className="font-medium">{v.rule_id}</span> {v.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SectionPreview({ sectionCode }: { sectionCode: string }) {
  const [history, setHistory] = useState<ElectionHistory[] | null>(null);
  const [location, setLocation] = useState<SectionLocation | null>(null);
  const [details, setDetails] = useState<Map<number, ElectionDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);

  useEffect(() => {
    setLoading(true);
    setDetails(new Map());
    setLocation(null);
    setHistory(null);
    fetch(`/api/elections/persistence/${sectionCode}`)
      .then((r) => r.json())
      .then((d: { elections: ElectionHistory[] }) => setHistory(d.elections))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [sectionCode]);

  useEffect(() => {
    if (!history?.length) return;
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
          protocol: sectionData.protocol,
          parties: sectionData.parties,
          violations: violationData.violations ?? [],
        } as ElectionDetail;
      }),
    );

    Promise.all(fetches).then((results) => {
      const m = new Map<number, ElectionDetail>();
      for (const r of results) {
        if (r) m.set(r.election_id, r);
      }
      setDetails(m);

      const first = results.find((r) => r);
      if (first) {
        fetch(`/api/elections/${first.election_id}/anomalies?section=${sectionCode}&min_risk=0&limit=1`)
          .then((r) => r.json())
          .then((d) => {
            const sec = d.sections?.[0];
            if (sec) setLocation({ settlement_name: sec.settlement_name, address: sec.address, lat: sec.lat, lng: sec.lng });
          })
          .catch(() => {});
      }
      setLoadingDetails(false);
    });
  }, [history, sectionCode]);

  if (loading) {
    return <div className="py-8 text-center text-xs text-muted-foreground">Зареждане...</div>;
  }

  if (!history?.length) {
    return <div className="py-8 text-center text-xs text-muted-foreground">Няма данни</div>;
  }

  const flaggedCount = history.filter((h) => h.risk_score >= 0.3).length;
  const avgRisk = history.reduce((s, h) => s + h.risk_score, 0) / history.length;
  const maxRisk = Math.max(...history.map((h) => h.risk_score));
  const hasCoords = location?.lat != null && location?.lng != null;

  return (
    <div className="space-y-3">
      {/* Location */}
      {location && (
        <div className="text-xs text-muted-foreground">
          {location.settlement_name}
          {location.address && <span> — {location.address}</span>}
        </div>
      )}

      {/* Map */}
      {hasCoords && (
        <div className="h-48 overflow-hidden rounded-lg border border-border">
          <MapGL viewport={{ center: [location!.lng!, location!.lat!], zoom: 15, bearing: 0, pitch: 0 }}>
            <MapMarker latitude={location!.lat!} longitude={location!.lng!}>
              <MarkerContent>
                <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-red-500 shadow-lg">
                  <div className="h-2 w-2 rounded-full bg-white" />
                </div>
              </MarkerContent>
            </MapMarker>
            <MapControls position="bottom-right" showZoom showCompass={false} />
          </MapGL>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg border border-border p-2 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Избори</div>
          <div className="text-sm font-bold">{history.length}</div>
        </div>
        <div className="rounded-lg border border-border p-2 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Флагнати</div>
          <div className="text-sm font-bold">{flaggedCount}<span className="text-xs font-normal text-muted-foreground">/{history.length}</span></div>
        </div>
        <div className="rounded-lg border border-border p-2 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Ср. риск</div>
          <div className="mt-0.5"><RiskBadge value={avgRisk} /></div>
        </div>
        <div className="rounded-lg border border-border p-2 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Макс.</div>
          <div className="mt-0.5"><RiskBadge value={maxRisk} /></div>
        </div>
      </div>

      {/* Risk timeline */}
      <div className="rounded-lg border border-border bg-background p-2.5">
        <div className="flex items-end gap-0.5">
          {history.map((h) => (
            <div key={h.election_id} className="group flex flex-1 flex-col items-center gap-0.5">
              <span className="text-[7px] font-mono tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                {h.risk_score.toFixed(2)}
              </span>
              <div
                className={`w-full rounded-t ${riskBg(h.risk_score)}`}
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

      {/* Actions */}
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
        <button
          onClick={() => setShowCorrection(true)}
          className="rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-center text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Грешна локация
        </button>
      </div>

      {showCorrection && (
        <LocationCorrection
          sectionCode={sectionCode}
          electionId={String(history[0]?.election_id ?? "")}
          settlementName={location?.settlement_name ?? ""}
          address={location?.address ?? null}
          currentLat={location?.lat ?? null}
          currentLng={location?.lng ?? null}
          onClose={() => setShowCorrection(false)}
        />
      )}

      {/* Election cards */}
      {loadingDetails && (
        <div className="py-4 text-center text-xs text-muted-foreground">Зареждане на протоколи...</div>
      )}

      {details.size > 0 && (
        <div className="space-y-2">
          {history.map((h) => {
            const detail = details.get(h.election_id);
            if (!detail) return null;
            return <ElectionCard key={h.election_id} detail={detail} history={h} />;
          })}
        </div>
      )}
    </div>
  );
}
