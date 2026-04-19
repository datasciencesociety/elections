/**
 * Live camera metrics from the Hetzner vision fleet. One-day election-day
 * feature. The endpoint is gzipped JSON with CORS `*` and no auth, keyed by
 * zero-padded 9-digit section code — the same format our `section_code`
 * uses everywhere else.
 *
 * Unlike the rest of `lib/api/`, this talks to a different host
 * (`karta.izborenmonitor.com/video`) and not our `/api` server, so it calls
 * `fetch` directly instead of going through `client.ts`.
 */

const METRICS_URL = "https://karta.izborenmonitor.com/video/metrics";
const SECTIONS_URL = "https://karta.izborenmonitor.com/video/sections";

export type LiveStatus = "ok" | "dark" | "covered" | "frozen" | "unknown";

export interface LiveSectionMetric {
  status: LiveStatus;
  luma?: number;
  motion_diff?: number;
  cover_ratio?: number;
  frozen_sec?: number;
  snapshot_url?: string;
  box_ip?: string;
  reported_at?: number;
}

export type LiveMetrics = Record<string, LiveSectionMetric>;

export async function getLiveMetrics(): Promise<LiveMetrics> {
  const res = await fetch(METRICS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
  return (await res.json()) as LiveMetrics;
}

/**
 * Directory of sections that currently have an active video stream. The
 * back-end may return different fields over time — we consume it as a loose
 * object keyed off `section_code`. At the time this was written the
 * discovery endpoint was still empty; the shape below is a best-effort cast
 * that the UI degrades from if fields are missing.
 */
export interface LiveStreamEntry {
  section_code: string;
  stream_url?: string;
  hls_url?: string;
  box_ip?: string;
  [k: string]: unknown;
}

export interface LiveSectionsResponse {
  sections: LiveStreamEntry[];
  count: number;
  updated_at: number;
}

export async function getLiveSectionsDirectory(): Promise<LiveSectionsResponse> {
  const res = await fetch(SECTIONS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`video/sections HTTP ${res.status}`);
  return (await res.json()) as LiveSectionsResponse;
}
