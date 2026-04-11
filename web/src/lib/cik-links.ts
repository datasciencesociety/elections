/**
 * Build CIK protocol + scan links for a section in a given election.
 *
 * CIK's results page uses a hash router. The landing URL for a given area is
 * `{prefix}/rezultati/{area}.html`, and the fragment drives the modal:
 *     #/p/{dataEl}/{sectionCode}{protoSuffix}.html  — numeric protocol
 *     #/s/{dataEl}/{sectionCode}{scanSuffix}.pdf    — scanned PDF
 *
 * Two things differ per election:
 *   • `areaLen` — how many leading digits of the section code form the
 *     page path. National elections use 2 (oblast / RIK). mi2023 local
 *     elections use 4 (oblast + municipality) because the page is a
 *     per-municipality roll-up.
 *   • `protoSuffix` / `scanSuffix` — the ".0" / ".1" discriminator. These
 *     are not always the same — mi2023 protocols use `.1.html` while the
 *     scanned PDFs use `.0.pdf`. Earlier cycles (pi2021) use no suffix.
 *
 * `dataEl` is the internal CIK ballot id (64 = parliament/president,
 * 256 = president round, 1/2/4/8 = council/mayor/kmetstvo/neighbourhood).
 *
 * Video links are intentionally omitted: CIK takes the evideo.bg recordings
 * down after every cycle and the old links 404 for every past election.
 *
 * If you add a new election to the database, add a row here too — otherwise
 * `buildProtocolLinks` returns null and the sidebar drops the CIK link.
 */

interface CikConfig {
  prefix: string;
  type: "p" | "pk";
  protoSuffix: string;
  scanSuffix: string;
  dataEl: number;
  /** Leading digits of section_code used for the `/rezultati/{area}.html` path. */
  areaLen: number;
}

export const CIK_ELECTION_MAP: Record<number, CikConfig> = {
  1: { prefix: "pe202410", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  2: { prefix: "pe202410_ks", type: "pk", protoSuffix: ".0", scanSuffix: ".0", dataEl: 2, areaLen: 2 },
  3: { prefix: "europe2024/ns", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  4: { prefix: "europe2024/ep", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  // mi2023 — hash router lives under mi2023/tur{N}/rezultati/{4-digit-mun}.html.
  // Protocols: .1.html. Scanned PDFs: .0.pdf. All 4 election types share the
  // same page; dataEl selects council / mayor / kmetstvo / neighbourhood.
  5: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 1, areaLen: 4 },
  6: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 2, areaLen: 4 },
  7: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 4, areaLen: 4 },
  8: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 8, areaLen: 4 },
  9: { prefix: "mi2023/tur2", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 2, areaLen: 4 },
  10: { prefix: "mi2023/tur2", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 4, areaLen: 4 },
  11: { prefix: "mi2023/tur2", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 8, areaLen: 4 },
  12: { prefix: "ns2023", type: "p", protoSuffix: ".1", scanSuffix: ".1", dataEl: 64, areaLen: 2 },
  13: { prefix: "ns2022", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  14: { prefix: "pvrns2021/tur1", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  15: { prefix: "pvrns2021/tur1", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 256, areaLen: 2 },
  16: { prefix: "pvrns2021/tur2", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 256, areaLen: 2 },
  17: { prefix: "pi2021_07", type: "p", protoSuffix: ".0", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  18: { prefix: "pi2021", type: "p", protoSuffix: "", scanSuffix: "", dataEl: 64, areaLen: 2 },
};

export interface ProtocolLinks {
  protocol: string;
  scan: string;
}

export function buildProtocolLinks(
  sectionCode: string,
  electionId: number,
): ProtocolLinks | null {
  const config = CIK_ELECTION_MAP[electionId];
  if (!config) return null;
  const area = sectionCode.slice(0, config.areaLen);
  const base = `https://results.cik.bg/${config.prefix}/rezultati/${area}.html`;
  return {
    protocol: `${base}#/${config.type}/${config.dataEl}/${sectionCode}${config.protoSuffix}.html`,
    scan: `${base}#/s/${config.dataEl}/${sectionCode}${config.scanSuffix}.pdf`,
  };
}
