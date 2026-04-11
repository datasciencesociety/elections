/**
 * Build CIK protocol/scan/video links for a section in a given election.
 *
 * CIK uses different URL prefixes per election cycle and different "data
 * element" codes for each ballot type within a single year. The mapping was
 * reverse-engineered from `data/scrape_cik_addresses.py` and the per-election
 * suffix rules:
 *
 *   pi2021 (Apr 2021):     no suffix — URLs are just {code}.html
 *   pi2021_07 / pvrns2021 / ns2022:  ".0"
 *   ns2023 / mi2023*:                ".1"
 *   europe2024+ / pe202410+:         ".0" (machine) or ".1" (no machine)
 *                                    we default to ".0"
 *
 * The `dataEl` field is the URL fragment that selects which ballot the
 * results page should display (parliament, president, council, etc.).
 *
 * If you add a new election to the database, add a row here too — otherwise
 * `buildProtocolLinks` returns null and the sidebar drops the CIK link.
 */

interface CikConfig {
  prefix: string;
  type: "p" | "pk";
  suffix: string;
  dataEl: number;
  video?: string;
}

export const CIK_ELECTION_MAP: Record<number, CikConfig> = {
  1: { prefix: "pe202410", type: "p", suffix: ".0", dataEl: 64, video: "pe202410" },
  2: { prefix: "pe202410_ks", type: "pk", suffix: ".0", dataEl: 2, video: "pe202410" },
  3: { prefix: "europe2024/ns", type: "p", suffix: ".0", dataEl: 64, video: "europe2024" },
  4: { prefix: "europe2024/ep", type: "p", suffix: ".0", dataEl: 64, video: "europe2024" },
  5: { prefix: "mi2023/os", type: "p", suffix: ".1", dataEl: 1 },
  6: { prefix: "mi2023/kmet", type: "p", suffix: ".1", dataEl: 2 },
  7: { prefix: "mi2023/ko", type: "p", suffix: ".1", dataEl: 4 },
  8: { prefix: "mi2023/kr", type: "p", suffix: ".1", dataEl: 8 },
  9: { prefix: "mi2023_tur2/kmet", type: "p", suffix: ".1", dataEl: 2 },
  10: { prefix: "mi2023_tur2/ko", type: "p", suffix: ".1", dataEl: 4 },
  11: { prefix: "mi2023_tur2/kr", type: "p", suffix: ".1", dataEl: 8 },
  12: { prefix: "ns2023", type: "p", suffix: ".1", dataEl: 64, video: "ns2023" },
  13: { prefix: "ns2022", type: "p", suffix: ".0", dataEl: 64, video: "ns2022" },
  14: { prefix: "pvrns2021/tur1", type: "p", suffix: ".0", dataEl: 64, video: "pvrns2021" },
  15: { prefix: "pvrns2021/tur1", type: "p", suffix: ".0", dataEl: 256, video: "pvrns2021" },
  16: { prefix: "pvrns2021/tur2", type: "p", suffix: ".0", dataEl: 256, video: "pvrns2021" },
  17: { prefix: "pi2021_07", type: "p", suffix: ".0", dataEl: 64, video: "pi2021_07" },
  18: { prefix: "pi2021", type: "p", suffix: "", dataEl: 64, video: "pi2021" },
};

export interface ProtocolLinks {
  protocol: string;
  scan: string;
  video: string | null;
}

export function buildProtocolLinks(
  sectionCode: string,
  electionId: number,
): ProtocolLinks | null {
  const config = CIK_ELECTION_MAP[electionId];
  if (!config) return null;
  const rik = sectionCode.slice(0, 2);
  const s = config.suffix;
  return {
    protocol: `https://results.cik.bg/${config.prefix}/rezultati/${rik}.html#/${config.type}/${config.dataEl}/${sectionCode}${s}.html`,
    scan: `https://results.cik.bg/${config.prefix}/rezultati/${rik}.html#/s/${config.dataEl}/${sectionCode}${s}.pdf`,
    video: config.video
      ? `https://evideo.bg/${config.video}/${rik}.html#${sectionCode}`
      : null,
  };
}
