import type { AnomalySection, SectionDetail } from "@/lib/api/types.js";
import { FormulaRow } from "@/components/score/index.js";

/**
 * The actual Benford explanation rendered inside `BenfordCard`. Walks the
 * reader through:
 *   1. What Benford's Law is.
 *   2. Each party's vote count and its first digit.
 *   3. A side-by-side bar chart of observed vs expected distribution.
 *   4. The chi-square / p-value verdict + sample-size caveat.
 *
 * Pure presentation — derives everything from `section` and `parties`.
 */

// Benford's Law expected distribution for first digits 1–9.
const BENFORD_EXPECTED = [
  0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046,
];

export function BenfordDetail({
  section: s,
  parties,
}: {
  section: AnomalySection;
  parties: SectionDetail["parties"] | null;
}) {
  const partyDigits: { name: string; votes: number; digit: number }[] = [];
  const digitCounts = new Array(9).fill(0);
  if (parties) {
    for (const p of parties) {
      if (p.votes > 0) {
        const digit = parseInt(String(p.votes)[0], 10);
        if (digit >= 1 && digit <= 9) {
          partyDigits.push({ name: p.short_name, votes: p.votes, digit });
          digitCounts[digit - 1]++;
        }
      }
    }
  }
  const totalDigits = partyDigits.length;
  const observed = totalDigits > 0
    ? digitCounts.map((c) => c / totalDigits)
    : null;

  return (
    <>
      {/* Step 1 — what Benford's Law actually says */}
      <div className="mb-3 text-xs text-muted-foreground">
        Вземаме броя гласове на всяка партия и гледаме с коя цифра започва.
        По закона на Бенфорд, в естествени данни цифрата „1" се среща първа в
        ~30% от случаите, „2" в ~18%, „3" в ~12%, и т.н. Ако някоя секция се
        отклонява силно, може да е знак за нередност.
      </div>

      {/* Step 2 — actual party votes and their first digits */}
      {partyDigits.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-2xs font-medium text-muted-foreground">
            Гласове по партии → първа цифра
          </div>
          <div className="space-y-0.5">
            {partyDigits.map((pd, i) => (
              <div key={i} className="flex items-center gap-1.5 text-2xs">
                <span
                  className="flex-1 truncate text-muted-foreground"
                  title={pd.name}
                >
                  {pd.name}
                </span>
                <span className="font-mono tabular-nums w-10 text-right">
                  {pd.votes}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono font-semibold w-3 text-center">
                  {pd.digit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 3 — observed vs expected bar comparison */}
      {observed && (
        <div className="mb-3">
          <div className="mb-1.5 text-2xs font-medium text-muted-foreground">
            Колко пъти се среща всяка първа цифра — реално vs по Бенфорд
          </div>
          <div className="space-y-1">
            {observed.map((o, i) => {
              const expected = BENFORD_EXPECTED[i];
              const maxVal = Math.max(o, expected, 0.35);
              const diff = Math.abs(o - expected);
              const barColor =
                diff > 0.15 ? "#ef4444" : diff > 0.08 ? "#f97316" : "#22c55e";
              return (
                <div key={i}>
                  <div className="flex items-center gap-1 text-2xs">
                    <span className="w-3 font-mono font-medium text-right">
                      {i + 1}
                    </span>
                    <div className="flex-1 relative h-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm bg-muted-foreground/15"
                        style={{ width: `${(expected / maxVal) * 100}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${(o / maxVal) * 100}%`,
                          background: barColor,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <span className="w-16 text-right text-[9px] font-mono tabular-nums text-muted-foreground">
                      {digitCounts[i]}/{totalDigits} = {(o * 100).toFixed(0)}%
                    </span>
                  </div>
                  {digitCounts[i] > 0 && diff > 0.08 && (
                    <div className="ml-4 text-[9px] text-muted-foreground/70">
                      очаквано {(expected * 100).toFixed(0)}%, реално{" "}
                      {(o * 100).toFixed(0)}%
                      {diff > 0.15 ? " — силно отклонение" : " — леко отклонение"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-muted-foreground/15" />{" "}
              По Бенфорд
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-score-low/70" />{" "}
              Тази секция
            </span>
          </div>
        </div>
      )}

      {/* Step 4 — statistical test result */}
      <div className="space-y-0.5">
        <FormulaRow label="χ² статистика" value={s.benford_chi2 ?? 0} />
        <FormulaRow label="p-стойност" value={s.benford_p ?? 1} />
      </div>

      {(s.benford_p ?? 1) <= 0.05 ? (
        <div className="mt-2 text-xs text-score-high">
          p = {(s.benford_p ?? 1).toFixed(3)} ≤ 0.05 — разпределението е
          статистически значимо различно от Бенфорд
        </div>
      ) : (s.benford_chi2 ?? 0) > 0 ? (
        <div className="mt-2 text-xs text-score-low">
          p = {(s.benford_p ?? 1).toFixed(3)} {">"} 0.05 — отклонението не е
          статистически значимо
        </div>
      ) : null}

      {totalDigits < 10 && totalDigits > 0 && (
        <div className="mt-1 text-2xs text-score-medium">
          Само {totalDigits} партии с гласове — малка извадка, тестът е
          по-ненадежден
        </div>
      )}

      <div className="mt-2 rounded bg-muted/50 p-1.5">
        <div className="text-2xs font-mono text-muted-foreground">
          benford_score = {s.benford_score.toFixed(2)} (нормализиран 0–1 чрез
          IQR)
        </div>
      </div>
    </>
  );
}
