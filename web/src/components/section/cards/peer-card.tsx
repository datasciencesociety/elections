import type { AnomalySection, SectionContext } from "@/lib/api/types.js";
import { FormulaRow, MethodologyCard } from "@/components/score/index.js";
import { pct2 } from "@/lib/utils.js";

/**
 * Peer-deviation methodology card. Compares the section's turnout and
 * party mix against other sections at the same EKATTE settlement, and
 * exposes the per-component scores that feed `peer_risk`.
 */
export function PeerCard({
  section,
  ctx,
}: {
  section: AnomalySection;
  ctx: SectionContext | null;
}) {
  const s = section;
  return (
    <MethodologyCard title="Отклонение от съседни секции" score={s.peer_risk}>
      <div className="mb-2 text-xs text-muted-foreground">
        Секциите в {s.settlement_name} ({ctx?.ekatte_peer_count ?? "?"} секции)
        би трябвало да имат сходна активност и партийни резултати. Рязко
        различаваща се секция заслужава внимание.
      </div>
      <div className="space-y-0.5">
        <FormulaRow
          label="Активност на секцията"
          value={pct2(s.turnout_rate * 100)}
          unit="%"
        />
        {ctx?.ekatte_avg_turnout != null && (
          <FormulaRow
            label={`Средно за ${s.settlement_name}`}
            value={pct2(ctx.ekatte_avg_turnout * 100)}
            unit="%"
          />
        )}
        <FormulaRow
          label="Z-score спрямо нас. място"
          value={s.ekatte_turnout_zscore}
        />
        <FormulaRow
          label="ekatte_zscore_norm"
          value={s.ekatte_turnout_zscore_norm}
        />
        <FormulaRow
          label="Партийно отклонение (χ²)"
          value={s.peer_vote_deviation}
        />
        <FormulaRow
          label="peer_vote_deviation_norm"
          value={s.peer_vote_deviation_norm}
        />
      </div>
      <div className="mt-2 rounded bg-muted/50 p-2">
        <div className="text-[10px] font-medium text-muted-foreground">
          Формула
        </div>
        <div className="mt-0.5 text-[11px] font-mono">
          peer_risk = (ekatte_zscore_norm + peer_vote_deviation_norm) / 2
        </div>
        <div className="mt-0.5 text-[11px] font-mono text-foreground">
          = ({s.ekatte_turnout_zscore_norm.toFixed(2)} +{" "}
          {s.peer_vote_deviation_norm.toFixed(2)}) / 2 ={" "}
          <span className="font-semibold">{s.peer_risk.toFixed(2)}</span>
        </div>
      </div>
    </MethodologyCard>
  );
}
