import "./instrument.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./app.js";
import { botMetaMiddleware } from "./og/bot-meta.js";

// Bot meta injection — intercepts social crawlers before static serving
app.use("/*", botMetaMiddleware);

// Cache headers for static assets.
// Hashed Vite bundles (/assets/*) are immutable — cache forever.
// Everything else (index.html via SPA fallback) gets a short browser
// cache so deploys propagate, but a longer CDN/nginx cache.
app.use("/*", async (c, next) => {
  await next();
  if (c.res.headers.has("Cache-Control")) return;          // API middleware already set it
  if (c.req.path.startsWith("/assets/")) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  } else if (c.res.headers.get("Content-Type")?.includes("text/html")) {
    c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
  }
});

// Serve Vite build output for production
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ root: "../web/dist", path: "index.html" }));

const port = Number(process.env.PORT) || 3000;
console.log(`Server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
