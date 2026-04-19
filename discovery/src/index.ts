import { serve } from "@hono/node-server";
import app from "./app.js";
import { startRebuildLoop } from "./cache.js";
import { startGcLoop } from "./gc.js";

const port = Number(process.env.PORT) || 3001;

startRebuildLoop();
startGcLoop();

console.log(`[discovery] listening on http://127.0.0.1:${port}`);
serve({ fetch: app.fetch, port });
