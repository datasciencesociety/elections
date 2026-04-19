import { cn } from "@/lib/utils";
import type { LiveStatus } from "@/lib/api/live-metrics.js";

/**
 * Live camera status as a coloured dot + Bulgarian label. Same vocabulary
 * everywhere — map legend, card header, tooltip — so the green/red/grey
 * mapping is learnable.
 *
 * `"live"` is the synthetic "ok + has a playable stream" state we render
 * with a different label than raw `ok`, so the user knows they can watch
 * right now.
 */
export type UiStatus = LiveStatus | "live" | "no_camera";

const LABELS: Record<UiStatus, string> = {
  live: "на живо",
  ok: "работи",
  covered: "покрита",
  dark: "тъмна",
  frozen: "замръзнала",
  unknown: "няма сигнал",
  no_camera: "без камера",
};

const TONES: Record<UiStatus, "green" | "red" | "amber" | "grey"> = {
  live: "green",
  ok: "green",
  covered: "red",
  dark: "red",
  frozen: "red",
  unknown: "grey",
  no_camera: "grey",
};

const TONE_CLASSES: Record<"green" | "red" | "amber" | "grey", { dot: string; text: string }> = {
  green: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  red: { dot: "bg-score-high", text: "text-score-high" },
  amber: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  grey: { dot: "bg-muted-foreground/60", text: "text-muted-foreground" },
};

export function LiveStatusBadge({
  status,
  className,
}: {
  status: UiStatus;
  className?: string;
}) {
  const tone = TONE_CLASSES[TONES[status]];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-eyebrow",
        tone.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {LABELS[status]}
    </span>
  );
}

export function statusTone(status: UiStatus) {
  return TONES[status];
}
