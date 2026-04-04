import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./app.js";

// Serve Vite build output for production
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ root: "../web/dist", path: "index.html" }));

const port = Number(process.env.PORT) || 3000;
console.log(`Server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
