/**
 * Client-side full-text search over every polling location.
 *
 * Architecture:
 *   - The server ships a single JSON blob (`/api/geography/search-index`) with
 *     ~12k rows. Fetch it once per session, cache forever in React Query.
 *   - Build a MiniSearch index lazily on first use.
 *   - Expose a typed `search()` function + a React hook.
 *
 * This file is the ONLY place where search behavior is tuned. Tokenization,
 * field weights, and result shaping live here; components don't care.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import MiniSearch, { type SearchResult } from "minisearch";
import { apiGet } from "../api/client.js";

// ---------- network ----------

/** Compact row shape — field names are intentionally one-letter to save ~40% on payload. */
interface RawLocation {
  id: number;
  s: string | null;        // settlement_name
  a: string | null;        // address
  dn: string | null;       // district_name
  mn: string | null;       // municipality_name
  rn: string | null;       // rik_name
  la: number | null;       // lat
  lg: number | null;       // lng
  n: number;               // section count
  c: string;               // representative section_code
}

interface SearchIndexResponse {
  locations: RawLocation[];
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

export interface LocationRow {
  id: number;
  settlement: string;
  address: string;
  municipality: string;
  district: string;
  rik: string;
  lat: number | null;
  lng: number | null;
  sectionCount: number;
  sectionCode: string;
  /** What MiniSearch actually indexes — never shown to the user. */
  searchable: string;
}

function shapeRow(raw: RawLocation): LocationRow {
  const settlement = stripSettlementPrefix(raw.s);
  const address = raw.a ?? "";
  const municipality = raw.mn ?? "";
  const district = raw.dn ?? "";
  const rik = raw.rn ?? "";
  return {
    id: raw.id,
    settlement,
    address,
    municipality,
    district,
    rik,
    lat: raw.la,
    lng: raw.lg,
    sectionCount: raw.n,
    sectionCode: raw.c,
    // Normalize once; MiniSearch tokenizes this field only.
    searchable: normalize(
      `${settlement} ${address} ${municipality} ${district} ${rik}`,
    ),
  };
}

// ---------- MiniSearch index ----------

function buildIndex(rows: LocationRow[]): MiniSearch<LocationRow> {
  const mini = new MiniSearch<LocationRow>({
    idField: "id",
    fields: ["searchable"],
    storeFields: [
      "id",
      "settlement",
      "address",
      "municipality",
      "district",
      "rik",
      "lat",
      "lng",
      "sectionCount",
      "sectionCode",
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

export interface LocationSearchResult extends LocationRow {
  score: number;
}

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
    const rows = indexQuery.data.locations.map(shapeRow);
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
    const raw = built.mini.search(normalized).slice(0, 8) as (SearchResult &
      LocationRow)[];
    setResults(
      raw.map((r) => ({
        id: r.id,
        settlement: r.settlement,
        address: r.address,
        municipality: r.municipality,
        district: r.district,
        rik: r.rik,
        lat: r.lat,
        lng: r.lng,
        sectionCount: r.sectionCount,
        sectionCode: r.sectionCode,
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
