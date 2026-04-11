import type { AnomalySection, SectionDetail } from "@/lib/api/types.js";
import { MethodologyCard } from "@/components/score/index.js";
import { BenfordDetail } from "./benford-detail.js";

/**
 * Thin wrapper that puts `BenfordDetail` inside the collapsible
 * `MethodologyCard`. Kept separate so the card layout can change without
 * touching the chart logic.
 */
export function BenfordCard({
  section,
  parties,
}: {
  section: AnomalySection;
  parties: SectionDetail["parties"] | null;
}) {
  return (
    <MethodologyCard title="Закон на Бенфорд" score={section.benford_risk}>
      <BenfordDetail section={section} parties={parties} />
    </MethodologyCard>
  );
}
