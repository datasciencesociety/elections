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
 *   • `protoSuffix` / `scanSuffix` — the form-type discriminator injected
 *     between the section code and the file extension. Verified against
 *     HAS_PROTO in each election's protokoli/data.js.
 *
 * Suffix semantics (from HAS_PROTO[dataEl][area][code] = { suffixNum: formTypeId }):
 *   "auto"  — suffix 0 = machine+paper combined (ХМ), suffix 1 = paper-only (Х).
 *             pe202410, pe202410_ks, europe2024, mi2023/tur2, ns2022, pvrns2021, pi2021_07.
 *   "auto2" — suffix 2 = machine+paper (ХМ), suffix 1 = paper-only (Х).
 *             ns2023 only: no suffix 0 exists in its HAS_PROTO.
 *   ".1"    — all sections use suffix 1 (paper-only). mi2023/tur1 has no machine voting.
 *   ""      — no suffix at all. pi2021 uses an older array-format HAS_PROTO.
 *
 * `dataEl` is the internal CIK ballot id verified in protokoli/data.js:
 *   64  = NS parliament (and EP when combined with NS in europe2024)
 *   128 = EP european parliament (europe2024 only)
 *   256 = president round 2
 *   1/2/4/8 = council/mayor/kmetstvo/neighbourhood (mi2023)
 *
 * europe2024 uses a single prefix "europe2024" for both the NS (dataEl 64)
 * and EP (dataEl 128) elections — there are no separate /ns/ or /ep/ subfolders.
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
  /**
   * Protocol suffix rule:
   *   "auto"  — machine_count > 0 → ".0" (ХМ combined), else ".1" (paper-only Х)
   *   "auto2" — machine_count > 0 → ".2" (ХМ combined), else ".1" (paper-only Х)
   *             Use for ns2023 where suffix 0 does not exist.
   *   fixed string — used as-is for all sections (e.g. ".1", "")
   */
  protoSuffix: string | "auto" | "auto2";
  scanSuffix: string;
  dataEl: number;
  /** Leading digits of section_code used for the `/rezultati/{area}.html` path. */
  areaLen: number;
}

const CIK_ELECTION_MAP: Record<number, CikConfig> = {
  // pe202410: HAS_PROTO dataEl=64, suffixes 0 (ХМ) and 1 (Х). 9510 machine, 3410 paper sections.
  1: { prefix: "pe202410", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  // pe202410_ks: same structure as pe202410 but special commission ballots. Uses HAS_PROTO + HAS_PROTO_KS.
  2: { prefix: "pe202410_ks", type: "pk", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  // europe2024: single site for both elections. dataEl 64 = NS parliament, 128 = EP.
  // Verified: /europe2024/protokoli/data.js (no /ns/ or /ep/ subfolders exist).
  3: { prefix: "europe2024", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  4: { prefix: "europe2024", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 128, areaLen: 2 },
  // mi2023/tur1: HAS_PROTO dataEls 1,2,4,8. All sections have only suffix 1 (paper-only — no machines in round 1).
  // Hash router lives under mi2023/tur{N}/rezultati/{4-digit-mun}.html.
  5: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 1, areaLen: 4 },
  6: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 2, areaLen: 4 },
  7: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 4, areaLen: 4 },
  8: { prefix: "mi2023/tur1", type: "p", protoSuffix: ".1", scanSuffix: ".0", dataEl: 8, areaLen: 4 },
  // mi2023/tur2: HAS_PROTO dataEls 2,4,8. Suffixes: 0 (machine-only), 1 (paper-only), 0+2 (machine+paper combined).
  // Most sections have suffix 0 (and 2 when combined). "auto" → .0 for machine sections is correct.
  9: { prefix: "mi2023/tur2", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 2, areaLen: 4 },
  10: { prefix: "mi2023/tur2", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 4, areaLen: 4 },
  11: { prefix: "mi2023/tur2", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 8, areaLen: 4 },
  // ns2023: HAS_PROTO dataEl=64. Suffix 1 = paper-only (Х), suffix 2 = machine+paper (ХМ).
  // Suffix 0 does NOT exist — "auto2" maps machine→.2, paper→.1.
  12: { prefix: "ns2023", type: "p", protoSuffix: "auto2", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  // ns2022: HAS_PROTO dataEl=64. Multiple suffixes per section (0+1 or 0+1+2 or 0+1+2+3).
  // Suffix 0 always present → "auto" (.0 for all) picks the combined protocol which exists for every section.
  13: { prefix: "ns2022", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  // pvrns2021/tur1: HAS_PROTO dataEls 64 (parliament) and 256 (president).
  // Multiple suffixes per section (0+1, 0+1+2, 0+1+2+3). Suffix 0 always present.
  14: { prefix: "pvrns2021/tur1", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  15: { prefix: "pvrns2021/tur1", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 256, areaLen: 2 },
  // pvrns2021/tur2: HAS_PROTO dataEl=256 only. Same multi-suffix pattern.
  16: { prefix: "pvrns2021/tur2", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 256, areaLen: 2 },
  // pi2021_07: HAS_PROTO dataEl=64. Multiple suffixes (0+1, 0+1+2, 0+1+2+3). Suffix 0 always present.
  17: { prefix: "pi2021_07", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
  // pi2021: HAS_PROTO dataEl=64 uses old array format (no suffix objects). No suffix in link.
  18: { prefix: "pi2021", type: "p", protoSuffix: "", scanSuffix: "", dataEl: 64, areaLen: 2 },
  // pe202604: same shape as pe202410. Live-stream video is available per section
  // via sections.video_url (populated from the evideo.bg scraper).
  19: { prefix: "pe202604", type: "p", protoSuffix: "auto", scanSuffix: ".0", dataEl: 64, areaLen: 2 },
};

interface ProtocolLinks {
  protocol: string;
  scan: string;
}

export function buildProtocolLinks(
  sectionCode: string,
  electionId: number,
  machineCount?: number,
): ProtocolLinks | null {
  const config = CIK_ELECTION_MAP[electionId];
  if (!config) return null;
  const area = sectionCode.slice(0, config.areaLen);
  const base = `https://results.cik.bg/${config.prefix}/rezultati/${area}.html`;
  const hasMachine = (machineCount ?? 0) > 0;
  const protoSuffix =
    config.protoSuffix === "auto"
      ? hasMachine ? ".0" : ".1"
      : config.protoSuffix === "auto2"
        ? hasMachine ? ".2" : ".1"
        : config.protoSuffix;
  return {
    protocol: `${base}#/${config.type}/${config.dataEl}/${sectionCode}${protoSuffix}.html`,
    scan: `${base}#/s/${config.dataEl}/${sectionCode}${config.scanSuffix}.pdf`,
  };
}
