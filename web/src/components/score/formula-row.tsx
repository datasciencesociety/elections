/**
 * Label-on-the-left, value-on-the-right row used inside score-card formula
 * blocks ("turnout_zscore: 1.42", etc.). Lives in the score module because
 * every consumer is a methodology card body.
 */
export function FormulaRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}
