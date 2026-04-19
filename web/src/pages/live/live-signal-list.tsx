import { X } from "lucide-react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics, LiveSectionMetric } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { addressTone } from "./live-map.js";

/**
 * Floating panel that lists every flagged section, split into two
 * buckets:
 *   - "на картата" — sections whose addresses render as red pins
 *   - "извън списъка" — metric entries for section codes that aren't in
 *     our address index (e.g. a 2025 test stream feeding metrics for
 *     the 2026 index). These would never appear as a red pin; the panel
 *     is the only place the user can see them.
 *
 * Opens from the "X сигнали" chip in the header.
 */
export function LiveSignalList({
  addresses,
  metrics,
  liveCodes,
  addressBySectionCode,
  onPick,
  onClose,
}: {
  addresses: LiveAddress[];
  metrics: LiveMetrics | undefined;
  liveCodes: Set<string>;
  addressBySectionCode: Map<string, LiveAddress>;
  onPick: (addressId: string) => void;
  onClose: () => void;
}) {
  // Addresses with at least one red section.
  const flaggedAddresses = addresses.filter(
    (a) => addressTone(a, metrics, liveCodes) === "red",
  );

  // Metric entries whose section isn't in our address file.
  const orphanMetrics: Array<[string, LiveSectionMetric]> = [];
  if (metrics) {
    for (const [code, m] of Object.entries(metrics)) {
      if (m.status !== "covered" && m.status !== "dark" && m.status !== "frozen") continue;
      if (!addressBySectionCode.has(code)) orphanMetrics.push([code, m]);
    }
  }

  const total = flaggedAddresses.length + orphanMetrics.length;

  return (
    <div className="absolute right-3 top-[4.5rem] z-20 flex max-h-[70vh] w-[min(380px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
            Сигнали
          </p>
          <p className="font-mono text-xs tabular-nums text-foreground">
            {total} {total === 1 ? "секция" : "секции"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Затвори"
        >
          <X size={14} />
        </button>
      </header>

      <div className="overflow-y-auto">
        {flaggedAddresses.length > 0 && (
          <>
            <p className="border-b border-border px-3 py-1.5 text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
              На картата
            </p>
            <ul className="divide-y divide-border/60">
              {flaggedAddresses.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onPick(a.id)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-secondary/60"
                  >
                    <div className="flex w-full items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold tabular-nums text-score-high">
                        {a.section_codes[0]}
                        {a.section_codes.length > 1 && (
                          <span className="ml-1 text-3xs text-muted-foreground">
                            +{a.section_codes.length - 1}
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground" title={a.address}>
                      {a.address}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {orphanMetrics.length > 0 && (
          <>
            <p className="border-b border-t border-border px-3 py-1.5 text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
              Извън списъка — няма точка на картата
            </p>
            <ul className="divide-y divide-border/60">
              {orphanMetrics.map(([code, m]) => (
                <li key={code} className="flex items-baseline gap-2 px-3 py-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-score-high">
                    {code}
                  </span>
                  <span className={cn("text-2xs uppercase tracking-eyebrow text-score-high")}>
                    {m.status}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {total === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Няма сигнали в момента.
          </p>
        )}
      </div>
    </div>
  );
}
