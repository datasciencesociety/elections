import { useQuery } from "@tanstack/react-query";
import {
  getLiveMetrics,
  getLiveSectionsDirectory,
  type LiveMetrics,
  type LiveSectionsResponse,
} from "../api/live-metrics.js";

/**
 * Poll `/video/metrics` every 5 s. Keeps the status map on every open video
 * card fresh, colours the map markers, and drives the red-border highlight
 * when a camera flips to covered/dark/frozen.
 */
export function useLiveMetrics() {
  return useQuery<LiveMetrics>({
    queryKey: ["live-metrics"],
    queryFn: getLiveMetrics,
    refetchInterval: 5000,
    staleTime: 4000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Poll `/video/sections` every 5 s. This is the source of truth for "can I
 * play a stream right now" — if a section is listed here, we use its
 * stream URL. Metrics alone aren't enough: a box can be reporting without
 * publishing a playable stream.
 */
export function useLiveStreamsDirectory() {
  return useQuery<LiveSectionsResponse>({
    queryKey: ["live-streams-directory"],
    queryFn: getLiveSectionsDirectory,
    refetchInterval: 5000,
    staleTime: 4000,
    refetchOnWindowFocus: true,
  });
}
