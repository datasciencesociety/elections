import { buildProtocolLinks } from "@/lib/cik-links.js";

/**
 * Three CIK links — protocol page, scanned PDF, optional video. The DB's
 * stored `protocol_url` is preferred when present (the import pipeline sets
 * it for newer elections); we fall back to a generated URL otherwise so
 * older elections don't lose their link silently.
 *
 * The "scanned PDF" URL for stored links is derived by swapping the
 * protocol-page fragment to the scan fragment. The "video" link only
 * exists for elections that had a vote-counting livestream.
 */
export function SectionLinks({
  electionId,
  sectionCode,
  storedProtocolUrl,
}: {
  electionId: string | number;
  sectionCode: string;
  storedProtocolUrl?: string | null;
}) {
  const generated = buildProtocolLinks(sectionCode, Number(electionId));
  const links = storedProtocolUrl
    ? {
        protocol: storedProtocolUrl,
        scan: storedProtocolUrl
          .replace("#/p/", "#/s/")
          .replace("#/pk/", "#/s/")
          .replace(/\.html$/, ".pdf"),
        video: generated?.video ?? null,
      }
    : generated;

  if (!links) return null;

  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
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
      {links.video && (
        <a
          href={links.video}
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
