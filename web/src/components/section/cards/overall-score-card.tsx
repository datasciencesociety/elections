import type { AnomalySection } from "@/lib/api/types.js";
import { FormulaRow, ScoreBar } from "@/components/score/index.js";

/**
 * Top-of-sidebar card with the combined score, a verbal verdict, and the
 * average-of-six formula breakdown that produced it.
 *
 * The verdict text is the only place in the page that hard-codes the
 * 0.3 / 0.6 thresholds — keep them in sync with `ScoreBar`'s colour bands.
 */
export function OverallScoreCard({ section }: { section: AnomalySection }) {
  const risk = section.risk_score;
  const verdict =
    risk >= 0.6
      ? "Силно отклонение от нормалното — заслужава проверка"
      : risk >= 0.3
        ? "Средно отклонение — заслужава проверка"
        : "В норма";

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Комбиниран резултат
        </span>
        <span className="text-sm font-bold font-mono tabular-nums">
          {risk.toFixed(2)}
        </span>
      </div>
      <ScoreBar value={risk} className="mb-2" />
      <div className="text-xs font-medium">{verdict}</div>
      <div className="mt-2 rounded bg-muted/50 p-2">
        <div className="mb-1 text-[10px] font-medium text-muted-foreground">
          Формула
        </div>
        <div className="text-[11px] font-mono leading-relaxed">
          резултат = (аритм. грешка + несъответствие + активност_норм + бенфорд +
          активност_населено_норм + партийно_отклонение_норм) / 6
        </div>
        <div className="mt-1.5 space-y-0.5">
          <FormulaRow
            label="Аритметична грешка в протокола"
            value={section.arithmetic_error}
          />
          <FormulaRow
            label="Несъответствие хартия+машина≠общо"
            value={section.vote_sum_mismatch}
          />
          <FormulaRow
            label="Активност спрямо МИР (норм.)"
            value={section.turnout_zscore}
          />
          <FormulaRow
            label="Отклонение по Бенфорд"
            value={section.benford_score}
          />
          <FormulaRow
            label="Активност спрямо нас. място (норм.)"
            value={section.ekatte_turnout_zscore_norm}
          />
          <FormulaRow
            label="Партийно отклонение от съседи (норм.)"
            value={section.peer_vote_deviation_norm}
          />
        </div>
      </div>
    </div>
  );
}
