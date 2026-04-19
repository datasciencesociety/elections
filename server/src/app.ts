import { Hono } from "hono";
import { cors } from "hono/cors";
import elections from "./routes/elections.js";
import geography from "./routes/geography.js";
import parties from "./routes/parties.js";
import { handleMcpRequest } from "./mcp/handler.js";
import og from "./og/route.js";

const app = new Hono();

// Public, read-only data — allow any origin so the SPA can be embedded or
// served from other hosts (izborenmonitor.com root, local dev, etc.).
app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

// All API data is static between deploys. Cache aggressively:
// - browsers cache 1 hour (max-age)
// - nginx/CDN caches 7 days (s-maxage)
// Individual routes can override with a more specific header.
app.use("/api/*", async (c, next) => {
  await next();
  if (c.res.status === 200 && !c.res.headers.has("Cache-Control")) {
    c.header("Cache-Control", "public, max-age=3600, s-maxage=604800");
  }
});

app.route("/og", og);
app.route("/api/elections", elections);
app.route("/api/geography", geography);
// Hidden for now — not ready for public release
// app.route("/api/parties", parties);

// MCP endpoint — stateless, tools call back into /api/* via HTTP (nginx-cached)
app.all("/mcp", async (c) => {
  return handleMcpRequest(c.req.raw);
});

export default app;
