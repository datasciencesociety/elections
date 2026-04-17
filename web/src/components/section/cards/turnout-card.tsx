import type { AnomalySection, SectionContext } from "@/lib/api/types.js";
import { FormulaRow } from "@/components/score/index.js";
import { pct2 } from "@/lib/utils.js";

/**
 * Turnout card — shows the section's own turnout, a comparison table
 * against RIK / settlement / municipality / previous election, and a
 * plain-language verdict on the size of the deviation.
 *
 * Pure presentation: takes the section row + the section context fetched
 * by the parent.
 */
export function TurnoutCard({
  section,
  ctx,
}: {
  section: AnomalySection;
  ctx: SectionContext | null;
}) {
  const s = section;
  const turnoutPct = pct2(s.turnout_rate * 100);

  const verdict =
    Math.abs(s.ekatte_turnout_zscore) > 3
      ? `Активността (${turnoutPct}%) е драстично различна от съседните секции в ${s.settlement_name} (${ctx?.ekatte_avg_turnout != null ? pct2(ctx.ekatte_avg_turnout * 100) + "%" : "—"})`
      : Math.abs(s.ekatte_turnout_zscore) > 2
        ? `Активността се отличава значително от съседните секции в ${s.settlement_name}`
        : Math.abs(s.ekatte_turnout_zscore) > 1
          ? "Леко отклонение от съседните секции"
          : "Нормална активност спрямо района";

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        Избирателна активност
      </div>
      <div className="text-xl font-bold">{turnoutPct}%</div>
      {s.turnout_rate > 1 && (
        <div className="mt-1 text-xs font-medium text-score-high">
          Повече гласували от регистрирани — възможна грешка в данните или
          допълнително вписани
        </div>
      )}

      {ctx && (
        <div className="mt-2 space-y-0.5 text-xs">
          <div className="mb-1 text-2xs font-medium text-muted-foreground">
            Сравнение
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Тази секция</span>
            <span className="font-mono font-semibold tabular-nums">
              {turnoutPct}%
            </span>
          </div>
          {ctx.rik_avg_turnout != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Средно за МИР</span>
              <span className="font-mono tabular-nums">
                {pct2(ctx.rik_avg_turnout * 100)}%
              </span>
            </div>
          )}
          {ctx.ekatte_avg_turnout != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Средно за {s.settlement_name} ({ctx.ekatte_peer_count} секции)
              </span>
              <span className="font-mono tabular-nums">
                {pct2(ctx.ekatte_avg_turnout * 100)}%
              </span>
            </div>
          )}
          {ctx.municipality_avg_turnout != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Средно за общ. {ctx.municipality_name}
              </span>
              <span className="font-mono tabular-nums">
                {pct2(ctx.municipality_avg_turnout * 100)}%
              </span>
            </div>
          )}
          {ctx.prev_election && ctx.prev_turnout != null && (
            <div className="flex justify-between">
              <span
                className="text-muted-foreground truncate"
                title={ctx.prev_election.name}
              >
                Предишни ({ctx.prev_election.name})
              </span>
              <span className="font-mono tabular-nums">
                {pct2(ctx.prev_turnout * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 space-y-0.5">
        <FormulaRow label="Z-score спрямо МИР" value={s.turnout_zscore} />
        <FormulaRow
          label="Z-score спрямо населено място"
          value={s.ekatte_turnout_zscore}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{verdict}</div>
    </div>
  );
}
