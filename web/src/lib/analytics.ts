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
