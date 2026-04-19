/**
 * Tiny fetch wrapper used by every API module.
 *
 * Centralizes:
 *   - The base URL (`/api`) — change once if we ever serve from a CDN.
 *   - JSON parsing.
 *   - A consistent error shape: `ApiError(status, message)`.
 *
 * Pages and components must NOT call `fetch()` directly. They call functions
 * in `lib/api/*.ts`, which call `apiGet` here. That keeps the network layer
 * in one place so it can be swapped, mocked, or moved to React Query without
 * touching UI code.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface QueryParams {
  [key: string]: string | number | boolean | undefined | null;
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiGet<T>(
  path: string,
  query?: QueryParams,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(buildUrl(path, query), init);
  if (!res.ok) {
    let body: { error?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
