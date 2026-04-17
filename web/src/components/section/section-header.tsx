/**
 * Settlement name + section-type chip + address with a Google Maps icon.
 *
 * Used by every "show a section" surface as the first block. The section
 * type chip ("Подвижна" / "Болница" / etc.) only renders when the type is
 * non-default. The Google Maps link is omitted when there's no address.
 *
 * Takes a loose type so it can be fed by `AnomalySection`, `SectionGeo`, or
 * any other shape with these few fields. The accompanying `<SectionLocation>`
 * normalises before passing in.
 */

interface SectionHeaderProps {
  settlementName: string | null;
  address?: string | null;
  sectionType?: string | null;
}

const SECTION_TYPE_LABELS: Record<string, string> = {
  mobile: "Подвижна",
  hospital: "Болница",
  abroad: "Чужбина",
  prison: "Затвор",
};

export function SectionHeader({
  settlementName,
  address,
  sectionType,
}: SectionHeaderProps) {
  const typeLabel = sectionType ? SECTION_TYPE_LABELS[sectionType] : null;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>{settlementName ?? "—"}</span>
        {typeLabel && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium">
            {typeLabel}
          </span>
        )}
      </div>
      {address && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{address}</span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, ${settlementName ?? ""}, Bulgaria`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-blue-600 hover:underline"
            title="Виж в Google Maps"
          >
            🗺
          </a>
        </div>
      )}
    </div>
  );
}
