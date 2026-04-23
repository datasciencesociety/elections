import { buildProtocolLinks } from "@/lib/cik-links.js";

/**
 * CIK-facing links for one section: the numeric protocol page, the scanned
 * PDF, and (for pe202604+) the evideo.bg live-stream recording.
 *
 * Protocol + scan URLs are built from `cik-links.ts` which owns the per-
 * election URL shape. The DB's `sections.protocol_url` column is ignored
 * here — it was produced by an earlier pipeline with the wrong mi2023 shape
 * and keeping two generators in sync is a losing game.
 *
 * Video URLs come from `sections.video_url`, populated per-section from the
 * live-stream scraper JSON. Earlier cycles had no active video at the time
 * of import so `video_url` is NULL there.
 */
export function SectionLinks({
  electionId,
  sectionCode,
  machineCount,
  videoUrl,
}: {
  electionId: string | number;
  sectionCode: string;
  machineCount?: number;
  videoUrl?: string | null;
}) {
  const links = buildProtocolLinks(sectionCode, Number(electionId), machineCount);
  if (!links && !videoUrl) return null;

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {links && (
        <>
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
        </>
      )}
      {videoUrl && (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Видео
        </a>
      )}
    </div>
  );
}
