import type { AnomalySection, SectionContext } from "@/lib/api/types.js";
import { FormulaRow, MethodologyCard } from "@/components/score/index.js";
import { pct2 } from "@/lib/utils.js";

/**
 * ACF (Anti-Corruption Fund) methodology — three sub-models bundled into
 * one card:
 *
 *   1. Multi-component outlier — flags the section if it's an outlier in
 *      turnout AND winner-share AND invalid-ballot rate at municipality level.
 *   2. Turnout shift vs the previous election of the same type, minus the
 *      municipality trend.
 *   3. Party shift — same idea but for the largest per-party share change.
 *
 * Sub-models 2 and 3 are only meaningful when there's a comparable previous
 * election; the card falls back to "няма предишни избори" otherwise.
 */
export function AcfCard({
  section,
  ctx,
}: {
  section: AnomalySection;
  ctx: SectionContext | null;
}) {
  const s = section;
  const turnoutPct = pct2(s.turnout_rate * 100);

  return (
    <MethodologyCard title="АКФ (Антикорупционен фонд)" score={s.acf_risk}>
      <div className="mb-2 text-xs text-muted-foreground">
        <a
          href="https://acf.bg/wp-content/uploads/2021/05/rezultati_izbori_BGweb.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#ce463c] hover:underline"
        >
          Методология на Антикорупционен фонд
        </a>{" "}
        за идентифициране на контролиран и купен вот. Три подмодела — два
        сравняват с предишни избори, един анализира текущите резултати спрямо
        общ. {ctx?.municipality_name ?? "общината"}.
      </div>

      <AcfMulticomponent section={s} ctx={ctx} turnoutPct={turnoutPct} />
      <AcfTurnoutShift section={s} ctx={ctx} turnoutPct={turnoutPct} />
      <AcfPartyShift section={s} ctx={ctx} />
      <AcfFormula section={s} />
    </MethodologyCard>
  );
}

// ---------- Sub-model 1: multi-component outlier ----------

function AcfMulticomponent({
  section: s,
  ctx,
  turnoutPct,
}: {
  section: AnomalySection;
  ctx: SectionContext | null;
  turnoutPct: string;
}) {
  return (
    <div className="mb-3 rounded border border-border p-2">
      <div className="mb-1 text-[11px] font-semibold">
        1. Мулти-компонентен анализ спрямо общ. {ctx?.municipality_name ?? "—"}
      </div>
      <div className="mb-1 text-[11px] text-muted-foreground">
        Секцията е извънредна стойност ако надвишава Q3 + 2.2×IQR на общинско
        ниво. Флагва се само ако е извънредна и по трите критерия едновременно.
      </div>
      <div className="space-y-1">
        <div className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Активност</span>
            <span
              className={`font-mono font-medium ${s.acf_turnout_outlier ? "text-red-600" : "text-green-600"}`}
            >
              {s.acf_turnout_outlier ? "извънредна" : "в норма"}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/70">
            <span>Секция: {turnoutPct}%</span>
            <span>
              Средно за общината:{" "}
              {ctx?.municipality_avg_turnout != null
                ? pct2(ctx.municipality_avg_turnout * 100) + "%"
                : "—"}
            </span>
          </div>
        </div>
        <div className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">% на победител</span>
            <span
              className={`font-mono font-medium ${s.acf_winner_outlier ? "text-red-600" : "text-green-600"}`}
            >
              {s.acf_winner_outlier ? "извънредна" : "в норма"}
            </span>
          </div>
        </div>
        <div className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Невалидни бюлетини</span>
            <span
              className={`font-mono font-medium ${s.acf_invalid_outlier ? "text-red-600" : "text-green-600"}`}
            >
              {s.acf_invalid_outlier ? "извънредна" : "в норма"}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-1.5 rounded bg-muted/50 p-1.5">
        <div className="text-[10px] font-mono text-muted-foreground">
          acf_multicomponent = {s.acf_multicomponent.toFixed(2)}
          {s.acf_multicomponent >= 1
            ? " — извънредна и по трите критерия"
            : s.acf_multicomponent > 0
              ? ` — извънредна по ${Math.round(s.acf_multicomponent * 3)} от 3`
              : " — в норма и по трите"}
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-model 2: turnout shift ----------

function AcfTurnoutShift({
  section: s,
  ctx,
  turnoutPct,
}: {
  section: AnomalySection;
  ctx: SectionContext | null;
  turnoutPct: string;
}) {
  return (
    <div className="mb-3 rounded border border-border p-2">
      <div className="mb-1 text-[11px] font-semibold">
        2. Промяна в активността
      </div>
      {s.acf_turnout_shift != null && ctx?.prev_election ? (
        <>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Спрямо{" "}
            <span className="font-medium text-foreground">
              {ctx.prev_election.name}
            </span>
          </div>
          <div className="space-y-0.5 text-[11px]">
            {ctx.prev_turnout != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Активност тогава</span>
                <span className="font-mono tabular-nums">
                  {pct2(ctx.prev_turnout * 100)}%
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Активност сега</span>
              <span className="font-mono tabular-nums">{turnoutPct}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Промяна (минус общ. тренд)
              </span>
              <span className="font-mono font-medium tabular-nums">
                {pct2(s.acf_turnout_shift * 100)} пр.т.
              </span>
            </div>
          </div>
          <div className="mt-1.5 rounded bg-muted/50 p-1.5">
            <div className="text-[10px] font-mono text-muted-foreground">
              acf_turnout_shift_norm = {s.acf_turnout_shift_norm.toFixed(2)}
            </div>
          </div>
        </>
      ) : s.acf_turnout_shift != null ? (
        <div className="space-y-0.5">
          <FormulaRow
            label="Промяна (минус общ. тренд)"
            value={s.acf_turnout_shift}
          />
          <FormulaRow
            label="acf_turnout_shift_norm"
            value={s.acf_turnout_shift_norm}
          />
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/70">
          Няма предишни избори от същия тип — моделът не е приложим
        </div>
      )}
    </div>
  );
}

// ---------- Sub-model 3: party shift ----------

function AcfPartyShift({
  section: s,
  ctx,
}: {
  section: AnomalySection;
  ctx: SectionContext | null;
}) {
  return (
    <div className="mb-3 rounded border border-border p-2">
      <div className="mb-1 text-[11px] font-semibold">
        3. Промяна в партийните резултати
      </div>
      {s.acf_party_shift != null && ctx?.prev_election ? (
        <>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Спрямо{" "}
            <span className="font-medium text-foreground">
              {ctx.prev_election.name}
            </span>
          </div>
          <div className="space-y-0.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Макс. промяна в дял на партия
              </span>
              <span className="font-mono font-medium tabular-nums">
                {pct2(s.acf_party_shift * 100)} пр.т.
              </span>
            </div>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Промяната е спрямо предишните избори, минус средната промяна в общ.{" "}
            {ctx.municipality_name} (за да се изключи национален тренд).
          </div>
          <div className="mt-1.5 rounded bg-muted/50 p-1.5">
            <div className="text-[10px] font-mono text-muted-foreground">
              acf_party_shift_norm = {s.acf_party_shift_norm.toFixed(2)}
            </div>
          </div>
        </>
      ) : s.acf_party_shift != null ? (
        <div className="space-y-0.5">
          <FormulaRow
            label="Макс. промяна (минус общ. тренд)"
            value={s.acf_party_shift}
          />
          <FormulaRow
            label="acf_party_shift_norm"
            value={s.acf_party_shift_norm}
          />
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/70">
          Няма предишни избори от същия тип — моделът не е приложим
        </div>
      )}
    </div>
  );
}

// ---------- Composite formula footer ----------

function AcfFormula({ section: s }: { section: AnomalySection }) {
  return (
    <div className="rounded bg-muted/50 p-2">
      <div className="text-[10px] font-medium text-muted-foreground">
        Формула
      </div>
      {s.acf_turnout_shift != null ? (
        <>
          <div className="mt-0.5 text-[11px] font-mono">
            acf_risk = (multicomponent + turnout_shift_norm + party_shift_norm) / 3
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-foreground">
            = ({s.acf_multicomponent.toFixed(2)} +{" "}
            {s.acf_turnout_shift_norm.toFixed(2)} +{" "}
            {s.acf_party_shift_norm.toFixed(2)}) / 3 ={" "}
            <span className="font-semibold">{s.acf_risk.toFixed(2)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="mt-0.5 text-[11px] font-mono">
            acf_risk = acf_multicomponent (няма предишни избори)
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-foreground">
            = <span className="font-semibold">{s.acf_multicomponent.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  );
}
