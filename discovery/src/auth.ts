import type { Context, Next } from "hono";

// Split-key auth.
//
// Every client sends:  Authorization: Bearer <SECRET>:<identifier>
//   • SECRET     is shared (env: PROXY_SECRET). Rotating it retires everyone.
//   • identifier is client-supplied:
//        - Hetzner boxes  → their public IP, auto-composed at boot
//        - humans         → their name (georgi, alice, …), baked into
//                           the full key Georgi hands them once.
//
// Security parity with the previous single-secret scheme: anyone who knows
// SECRET can claim any identifier. That's fine for this project's trust
// model — the identifier is for attribution and box↔section assignment,
// not authentication.

const SECRET: string = (() => {
  const s = process.env.PROXY_SECRET;
  if (!s) {
    console.error("[auth] FATAL: PROXY_SECRET env var is required");
    process.exit(1);
  }
  return s;
})();

declare module "hono" {
  interface ContextVariableMap {
    apiUser: string;
  }
}

export async function requireBearer(c: Context, next: Next) {
  const header = c.req.header("authorization") || "";
  if (!header.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);
  const raw = header.slice(7);
  const sep = raw.indexOf(":");
  if (sep <= 0) return c.json({ error: "malformed api key — expected <secret>:<identifier>" }, 401);
  const presentedSecret = raw.slice(0, sep);
  const identifier = raw.slice(sep + 1).trim();
  if (!identifier) return c.json({ error: "empty identifier" }, 401);
  if (!timingSafeEqualStr(presentedSecret, SECRET)) return c.json({ error: "unauthorized" }, 401);
  c.set("apiUser", identifier);
  await next();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
