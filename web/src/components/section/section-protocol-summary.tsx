import type { SectionDetail } from "@/lib/api/types.js";

/**
 * Standard protocol summary block — registered voters, added voters,
 * actual voters, turnout, valid/invalid, machine count. Used everywhere
 * a section's protocol is shown.
 *
 * Use `compact` for popovers and per-election cards in multi-election
 * walkers (drops a couple of rows and shrinks padding).
 *
 * Renders a placeholder while loading and nothing when there's no data.
 */
export function SectionProtocolSummary({
  detail,
  loading,
  compact = false,
}: {
  detail: SectionDetail | null;
  loading?: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="text-xs text-muted-foreground">
        Зареждане на резултати...
      </div>
    );
  }
  if (!detail) return null;

  const p = detail.protocol;
  const turnoutPct =
    p.registered_voters > 0
      ? (Math.floor((p.actual_voters / p.registered_voters) * 10000) / 100).toFixed(2)
      : "—";

  if (compact) {
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0 text-2xs">
        <Stat label="Зап." value={p.registered_voters} />
        <Stat label="Глас." value={p.actual_voters} />
        <Stat label="Акт." value={`${turnoutPct}%`} highlight={p.actual_voters > p.registered_voters} />
        {p.added_voters > 0 && <Stat label="Доп." value={p.added_voters} />}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-xs">
      <Row label="Регистрирани" value={p.registered_voters?.toLocaleString()} />
      <Row label="Вписани допълнително" value={p.added_voters?.toLocaleString()} />
      <Row label="Гласували" value={p.actual_voters?.toLocaleString()} />
      <Row
        label="Активност"
        value={`${turnoutPct}%`}
        bold
        warn={p.actual_voters > p.registered_voters}
      />
      <Row
        label="Валидни"
        value={p.valid_votes?.toLocaleString()}
        valueClass="text-score-low"
      />
      <Row
        label="Невалидни"
        value={(p.invalid_votes + (p.null_votes ?? 0))?.toLocaleString()}
        valueClass="text-score-high"
      />
      <Row
        label="Машинно гласуване"
        value={p.machine_count > 0 ? `Да (${p.machine_count})` : "Не"}
      />
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
  warn = false,
  valueClass,
}: {
  label: string;
  value: string | undefined;
  bold?: boolean;
  warn?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? "font-semibold" : "font-medium"} ${warn ? "text-score-high" : valueClass ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <span>
      <span className="text-muted-foreground">{label}</span>{" "}
      <span
        className={`font-mono tabular-nums ${highlight ? "font-semibold text-score-high" : ""}`}
      >
        {value}
      </span>
    </span>
  );
}
