/**
 * Client-side full-text search over every polling section.
 *
 * Architecture:
 *   - The server ships a single JSON blob (`/api/geography/search-index`) —
 *     one row per `section_code` with the location fields copied in. Sections
 *     that share an address show identical searchable text, so MiniSearch
 *     ranks them together and they cluster naturally in the results.
 *   - Fetch it once per session, cache forever in React Query.
 *   - Build a MiniSearch index lazily on first use.
 *   - `useLocationSearch` returns a flat list of section rows; consumers
 *     (search-box, section-search-input) are responsible for grouping the
 *     results by address at render time.
 *
 * This file is the ONLY place where search behavior is tuned. Tokenization,
 * field weights, and result shaping live here; components don't care.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import MiniSearch, { type SearchResult } from "minisearch";
import { apiGet } from "../api/client.js";

// ---------- network ----------

/** Compact row shape — field names are intentionally one-letter to save gzip. */
interface RawSection {
  lid: number;            // location_id — used to group adjacent results
  c: string;              // section_code — primary identity
  s: string | null;       // settlement_name
  a: string | null;       // address
  dn: string | null;      // district_name
  mn: string | null;      // municipality_name
  rn: string | null;      // rik_name
  la: number | null;      // lat
  lg: number | null;      // lng
}

interface SearchIndexResponse {
  sections: RawSection[];
}

async function fetchSearchIndex(): Promise<SearchIndexResponse> {
  return apiGet<SearchIndexResponse>("/geography/search-index");
}

// ---------- normalization ----------

/**
 * Lowercase + strip Bulgarian + Latin diacritics so "София" / "sofia" /
 * "Sofía" / "СОФИЯ" all match. Bulgarian has no diacritics proper but users
 * paste mixed text and the normalizer keeps things forgiving.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Strip the legacy prefix ("гр.", "с.", "кв.") that CIK attaches to settlement
// names — it confuses users who type "софия", not "гр.софия".
function stripSettlementPrefix(name: string | null): string {
  if (!name) return "";
  return name.replace(/^(гр\.|с\.|кв\.)\s*/i, "");
}

// ---------- shaped row for search/display ----------

export interface SectionRow {
  /** Unique id MiniSearch uses. Equals section_code. */
  id: string;
  /** section_code — stable across elections, identifies one building entry. */
  sectionCode: string;
  /** location_id — same for every section at the same address. */
  locationId: number;
  settlement: string;
  address: string;
  municipality: string;
  district: string;
  rik: string;
  lat: number | null;
  lng: number | null;
  /** What MiniSearch actually indexes — never shown to the user. */
  searchable: string;
}

function shapeRow(raw: RawSection): SectionRow {
  const settlement = stripSettlementPrefix(raw.s);
  const address = raw.a ?? "";
  const municipality = raw.mn ?? "";
  const district = raw.dn ?? "";
  const rik = raw.rn ?? "";
  return {
    id: raw.c,
    sectionCode: raw.c,
    locationId: raw.lid,
    settlement,
    address,
    municipality,
    district,
    rik,
    lat: raw.la,
    lng: raw.lg,
    // Normalize once; MiniSearch tokenizes this field only. We also include
    // the section_code so typing the number still finds the section.
    searchable: normalize(
      `${raw.c} ${settlement} ${address} ${municipality} ${district} ${rik}`,
    ),
  };
}

// ---------- MiniSearch index ----------

function buildIndex(rows: SectionRow[]): MiniSearch<SectionRow> {
  const mini = new MiniSearch<SectionRow>({
    idField: "id",
    fields: ["searchable"],
    storeFields: [
      "id",
      "sectionCode",
      "locationId",
      "settlement",
      "address",
      "municipality",
      "district",
      "rik",
      "lat",
      "lng",
    ],
    searchOptions: {
      prefix: true,
      fuzzy: 0.15,
      combineWith: "AND",
    },
  });
  mini.addAll(rows);
  return mini;
}

// ---------- React hook ----------

export interface LocationSearchResult extends SectionRow {
  score: number;
}

/** Max section rows returned to the caller. Big enough to cover a school
 * with ~15 sections at the same address; anything larger is noise. */
const MAX_RESULTS = 20;

export function useLocationSearch(query: string): {
  results: LocationSearchResult[];
  status: "idle" | "loading" | "ready" | "error";
  total: number;
} {
  const indexQuery = useQuery({
    queryKey: ["search-index"],
    queryFn: fetchSearchIndex,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Shape rows + build MiniSearch index memoized on the raw data.
  const built = useMemo(() => {
    if (!indexQuery.data) return null;
    const rows = indexQuery.data.sections.map(shapeRow);
    return { rows, mini: buildIndex(rows) };
  }, [indexQuery.data]);

  const [results, setResults] = useState<LocationSearchResult[]>([]);

  useEffect(() => {
    if (!built) {
      setResults([]);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const normalized = normalize(trimmed);
    const raw = built.mini.search(normalized).slice(0, MAX_RESULTS) as (SearchResult &
      SectionRow)[];
    // Re-cluster sections that share an address: MiniSearch scores identical
    // searchable text identically, so consecutive equal-score rows are
    // already adjacent — but ties can get broken by internal id order. Sort
    // by (score desc, locationId) to guarantee sections at the same address
    // stay contiguous in the output, which is what the grouped display
    // relies on.
    raw.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.locationId !== b.locationId) return a.locationId - b.locationId;
      return a.sectionCode.localeCompare(b.sectionCode);
    });
    setResults(
      raw.map((r) => ({
        id: r.id,
        sectionCode: r.sectionCode,
        locationId: r.locationId,
        settlement: r.settlement,
        address: r.address,
        municipality: r.municipality,
        district: r.district,
        rik: r.rik,
        lat: r.lat,
        lng: r.lng,
        searchable: "",
        score: r.score,
      }))
    );
  }, [built, query]);

  let status: "idle" | "loading" | "ready" | "error" = "idle";
  if (indexQuery.isLoading) status = "loading";
  else if (indexQuery.isError) status = "error";
  else if (built) status = "ready";

  return {
    results,
    status,
    total: built?.rows.length ?? 0,
  };
}

// ---------- grouping helper ----------

export interface SearchGroup {
  locationId: number;
  settlement: string;
  address: string;
  municipality: string;
  district: string;
  sections: LocationSearchResult[];
}

/**
 * Walk the ranked flat list and collapse consecutive rows that share a
 * locationId into one group. Preserves ranking order of groups.
 */
export function groupResultsByLocation(
  results: LocationSearchResult[],
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const r of results) {
    const last = groups[groups.length - 1];
    if (last && last.locationId === r.locationId) {
      last.sections.push(r);
    } else {
      groups.push({
        locationId: r.locationId,
        settlement: r.settlement,
        address: r.address,
        municipality: r.municipality,
        district: r.district,
        sections: [r],
      });
    }
  }
  return groups;
}
