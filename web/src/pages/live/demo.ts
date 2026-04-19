import type { LiveAddress } from "@/lib/api/live-sections.js";
import type {
  LiveMetrics,
  LiveSectionMetric,
  LiveStatus,
} from "@/lib/api/live-metrics.js";

/**
 * Simulation layer for the /live page. Activated by `?demo=1` in the URL
 * — replaces the real `/video/metrics` and `/video/sections` responses
 * with synthetic data so we can see every camera state (ok, covered, dark,
 * frozen, unknown) on the map and in the video cards before the real
 * stream goes live.
 *
 * We sample **sections** (not addresses) so that multi-room polling
 * locations get a mix of states — the school in your neighbourhood can
 * have one camera live and another covered, which is exactly the scenario
 * the UI needs to handle. Indices are evenly-spaced so reds and greens are
 * scattered across Bulgaria, not clumped into a single oblast.
 */

const SAMPLE_VIDEO_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const DISTRIBUTION: { status: LiveStatus; count: number; hasStream: boolean }[] = [
  { status: "ok", count: 180, hasStream: true }, // "live" cards
  { status: "ok", count: 120, hasStream: false }, // working cam, no stream yet
  { status: "covered", count: 45, hasStream: false },
  { status: "dark", count: 30, hasStream: false },
  { status: "frozen", count: 20, hasStream: false },
  { status: "unknown", count: 15, hasStream: false },
];

export interface DemoResult {
  metrics: LiveMetrics;
  streamBySection: Map<string, string>;
}

export function buildDemo(addresses: LiveAddress[]): DemoResult {
  const metrics: LiveMetrics = {};
  const streamBySection = new Map<string, string>();
  if (addresses.length === 0) return { metrics, streamBySection };

  // Flatten to a section-code list so we pick sections, not addresses.
  const codes: string[] = [];
  for (const a of addresses) {
    for (const c of a.section_codes) codes.push(c);
  }

  const total = DISTRIBUTION.reduce((n, d) => n + d.count, 0);
  const picked = pickEvenly(codes, total);

  let cursor = 0;
  const now = Date.now();
  for (const { status, count, hasStream } of DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      const code = picked[cursor++];
      if (!code) break;
      const metric: LiveSectionMetric = {
        status,
        reported_at: now - Math.floor(Math.random() * 60_000),
      };
      if (status === "ok" && hasStream) {
        metric.luma = 90 + Math.random() * 40;
        metric.motion_diff = 2 + Math.random() * 5;
      } else if (status === "covered") {
        metric.cover_ratio = 0.6 + Math.random() * 0.35;
      } else if (status === "dark") {
        metric.luma = 5 + Math.random() * 15;
      } else if (status === "frozen") {
        metric.frozen_sec = 10 + Math.random() * 120;
      }
      metrics[code] = metric;
      if (hasStream) streamBySection.set(code, SAMPLE_VIDEO_URL);
    }
  }

  return { metrics, streamBySection };
}

function pickEvenly<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items.slice();
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(items.length - 1, Math.floor(i * step));
    out.push(items[idx]);
  }
  return out;
}
