import type { ProtocolViolation } from "@/lib/api/types.js";

/**
 * Lists protocol arithmetic violations for a section. Renders nothing when
 * the list is empty so the parent doesn't need a guard.
 */
export function SectionViolations({
  violations,
}: {
  violations: ProtocolViolation[];
}) {
  if (violations.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">
        Нарушения в протокола ({violations.length})
      </div>
      {violations.map((v, i) => (
        <div
          key={i}
          className={`rounded-lg border p-2 text-[11px] ${
            v.severity === "error"
              ? "border-red-200 bg-red-50"
              : "border-yellow-200 bg-yellow-50"
          }`}
        >
          <div className="font-medium">
            <span className="font-mono text-[10px] text-muted-foreground">
              {v.rule_id}
            </span>{" "}
            {v.description}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            очаквано: {v.expected_value} → получено: {v.actual_value}
          </div>
        </div>
      ))}
    </div>
  );
}
