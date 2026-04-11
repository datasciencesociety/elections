import type { AnomalySection } from "@/lib/api/types.js";

/**
 * Two binary protocol flags shown above the methodology cards:
 *   - arithmetic_error: more votes cast than ballots received
 *   - vote_sum_mismatch: paper + machine ≠ total for at least one party
 *
 * Renders nothing when both are clear.
 */
export function BinaryFlags({ section: s }: { section: AnomalySection }) {
  if (!s.arithmetic_error && !s.vote_sum_mismatch) return null;

  return (
    <div className="space-y-1.5">
      {s.arithmetic_error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-medium text-red-800">
            Аритметична грешка в протокола
          </div>
          <div className="mt-1 text-[11px] text-red-600">
            Гласувалите са повече от получените бюлетини
          </div>
        </div>
      ) : null}
      {s.vote_sum_mismatch ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-medium text-red-800">
            Несъответствие в сумата на гласовете
          </div>
          <div className="mt-1 text-[11px] text-red-600">
            При поне една партия: хартиени + машинни ≠ общо
          </div>
        </div>
      ) : null}
    </div>
  );
}
