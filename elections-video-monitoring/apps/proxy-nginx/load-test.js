/**
 * k6 load test — simulates N concurrent HLS viewers
 *
 * Usage:
 *   k6 run --vus 500 --duration 60s load-test.js
 *   k6 run --vus 15000 --duration 3h load-test.js   # full soak
 *
 * Set TARGET_URL to your proxy base URL, PLAYLIST_PATH to any live .m3u8 path.
 */
import http from "k6/http";
import { sleep, check } from "k6";

const TARGET = __ENV.TARGET_URL || "http://localhost:80";
const PLAYLIST = __ENV.PLAYLIST_PATH || "/live/stream/index.m3u8";

export const options = {
  stages: [
    { duration: "2m",  target: 1000  },  // ramp up
    { duration: "10m", target: 5000  },
    { duration: "10m", target: 15000 },  // peak
    { duration: "5m",  target: 15000 },  // sustain
    { duration: "3m",  target: 0     },  // ramp down
  ],
  thresholds: {
    http_req_duration:        ["p(95)<500"],   // 95th percentile < 500 ms
    http_req_failed:          ["rate<0.01"],   // < 1% errors
    "http_req_duration{type:segment}": ["p(95)<200"],
  },
};

export default function viewer() {
  // 1. Fetch playlist
  const playlistRes = http.get(`${TARGET}${PLAYLIST}`, {
    tags: { type: "playlist" },
  });
  check(playlistRes, {
    "playlist 200":    (r) => r.status === 200,
    "has CORS header": (r) => r.headers["Access-Control-Allow-Origin"] === "*",
    "cache header set": (r) => r.headers["X-Cache-Status"] !== undefined,
  });

  // 2. Parse segment URLs from the playlist
  const lines = playlistRes.body.split("\n").filter(
    (l) => l.trim() && !l.startsWith("#")
  );

  if (lines.length === 0) return;

  // 3. Fetch next 3 segments (what a real player would buffer)
  const segments = lines.slice(0, 3);
  for (const seg of segments) {
    const segUrl = seg.startsWith("http") ? seg : `${TARGET}${seg}`;
    const segRes = http.get(segUrl, { tags: { type: "segment" } });
    check(segRes, {
      "segment 200": (r) => r.status === 200 || r.status === 206,
    });
    sleep(0.5);   // simulate ~2 s segment duration read over 4 fetches
  }

  sleep(1);  // HLS player poll interval
}
