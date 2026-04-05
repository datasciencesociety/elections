import { Hono } from "hono";
import elections from "./routes/elections.js";
import geography from "./routes/geography.js";
import parties from "./routes/parties.js";

const app = new Hono();

app.route("/api/elections", elections);
app.route("/api/geography", geography);
app.route("/api/parties", parties);

export default app;
