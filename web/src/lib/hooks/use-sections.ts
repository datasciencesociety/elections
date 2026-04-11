import { useQuery } from "@tanstack/react-query";
import {
  getSectionDetail,
  getSectionsGeo,
  getSectionViolations,
} from "../api/sections.js";

export function useSectionsGeo(
  electionId: string | number | undefined,
  filter: { district?: string; municipality?: string; rik?: string } = {},
) {
  return useQuery({
    queryKey: ["sections-geo", electionId, filter],
    queryFn: () => getSectionsGeo(electionId!, filter),
    enabled: electionId != null,
    staleTime: 5 * 60_000,
  });
}

export function useSectionDetail(
  electionId: string | number | undefined,
  sectionCode: string | undefined,
) {
  return useQuery({
    queryKey: ["section-detail", electionId, sectionCode],
    queryFn: () => getSectionDetail(electionId!, sectionCode!),
    enabled: electionId != null && !!sectionCode,
    staleTime: 5 * 60_000,
  });
}

export function useSectionViolations(
  electionId: string | number | undefined,
  sectionCode: string | undefined,
) {
  return useQuery({
    queryKey: ["section-violations", electionId, sectionCode],
    queryFn: () => getSectionViolations(electionId!, sectionCode!),
    enabled: electionId != null && !!sectionCode,
    staleTime: 5 * 60_000,
  });
}
