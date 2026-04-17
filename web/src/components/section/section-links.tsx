import { buildProtocolLinks } from "@/lib/cik-links.js";

/**
 * Two CIK links — numeric protocol page and the scanned PDF. Both are
 * generated from `cik-links.ts`, which owns the per-election URL shape
 * (prefix, area slice length, `.0` / `.1` suffix, dataEl). The DB's
 * `sections.protocol_url` column is ignored here — it was produced by an
 * earlier pipeline that hard-coded the mi2023 URL shape incorrectly, and
 * keeping two generators in sync is a losing game.
 *
 * Video is gone: CIK's evideo.bg recordings 404 for every past cycle.
 */
export function SectionLinks({
  electionId,
  sectionCode,
  machineCount,
}: {
  electionId: string | number;
  sectionCode: string;
  machineCount?: number;
}) {
  const links = buildProtocolLinks(sectionCode, Number(electionId), machineCount);
  if (!links) return null;

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <a
        href={links.protocol}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        Протокол
      </a>
      <a
        href={links.scan}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        Сканиран
      </a>
    </div>
  );
}
