/** Thin wrapper around gtag for type safety and convenience. */

type GtagCommand = "config" | "event" | "set";

declare global {
  interface Window {
    gtag?: (...args: [GtagCommand, string, Record<string, unknown>?]) => void;
  }
}

function gtag(command: GtagCommand, target: string, params?: Record<string, unknown>) {
  window.gtag?.(command, target, params);
}

/** Track a virtual page view (call on every route change). */
export function trackPageView(path: string, search: string) {
  gtag("event", "page_view", {
    page_path: path + search,
    page_title: document.title,
  });
}

/** Track a custom event. */
export function trackEvent(name: string, params?: Record<string, unknown>) {
  gtag("event", name, params);
}

/**
 * Send a periodic `engagement_time_msec` ping while the tab is visible and the
 * user has interacted in the last IDLE_MS. Fixes GA4's broken "avg engagement
 * time per session" metric on SPA pages that don't fire other events.
 */
export function startEngagementHeartbeat() {
  const INTERVAL_MS = 15_000;
  const IDLE_MS = 60_000;
  let lastTick = Date.now();
  let lastInteraction = Date.now();

  const bump = () => {
    lastInteraction = Date.now();
  };
  ["pointermove", "keydown", "wheel", "touchstart", "click"].forEach((ev) => {
    window.addEventListener(ev, bump, { passive: true });
  });

  setInterval(() => {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;
    if (document.visibilityState !== "visible") return;
    if (now - lastInteraction > IDLE_MS) return;
    gtag("event", "heartbeat", { engagement_time_msec: Math.min(delta, INTERVAL_MS * 2) });
  }, INTERVAL_MS);
}
