import type { Context, Next } from "hono";

const SECRET = process.env.PROXY_SECRET;

if (!SECRET) {
  console.error("[auth] PROXY_SECRET env var is required");
  process.exit(1);
}

// Constant-time Bearer-token check. All state-mutating /video/* routes use
// this. Reads (/video/metrics, /video/boxes, /video/assignments/my) are
// public — protected by being idempotent + cached at the edge.
export async function requireBearer(c: Context, next: Next) {
  const header = c.req.header("authorization") || "";
  const expected = `Bearer ${SECRET}`;
  if (!timingSafeEqualStr(header, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
