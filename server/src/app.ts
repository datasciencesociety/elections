import { Hono } from "hono";
import elections from "./routes/elections.js";

const app = new Hono();

app.route("/api/elections", elections);

export default app;
