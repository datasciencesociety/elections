## Context

The project has a rich SQLite database (`elections.db`) with 18 elections and full vote-level data, but no web interface for browsing it. The existing stack mentions Express + better-sqlite3 for dev and Vite + React for frontend, but nothing is wired up yet. This change creates the minimal vertical slice: DB -> API -> Browser.

## Goals / Non-Goals

**Goals:**
- Prove data flows end-to-end from SQLite to a browser table
- Establish the server and client directory structure for future work
- Keep the dev experience simple: one command to start both API and SPA

**Non-Goals:**
- Maps, charts, or any rich visualization (future work)
- Authentication or write endpoints
- Production deployment configuration (Cloudflare Workers, R2)
- Filtering, pagination, or search on the API
- Aggregation beyond summing votes per party across all sections

## Decisions

### 1. Hono over Express

**Choice**: Use Hono as the HTTP framework instead of Express.

**Rationale**: Hono is lighter, TypeScript-native, and designed for edge runtimes. When the project moves to Cloudflare Workers for production, Hono runs natively there — no rewrite needed. Express is mentioned in the current context as an existing convention, but since no Express code exists yet, switching now costs nothing.

**Alternatives considered**: Express (heavier, less edge-friendly), Fastify (good but no edge story).

### 2. Monorepo with server/ and web/ directories

**Choice**: Place API code in `server/` and SPA code in `web/`, with a root `package.json` using npm workspaces.

**Rationale**: Keeps concerns separated while sharing a single `node_modules`. Matches the project convention of top-level directories for distinct concerns (`data/`, `openspec/`).

**Alternatives considered**: Single directory with Vite plugin for API (too coupled), separate repos (overkill for this scope).

### 3. Vite proxy for dev, Hono static serving for prod

**Choice**: In development, Vite dev server proxies `/api/*` to the Hono server. In production build, Hono serves the Vite build output and handles SPA fallback.

**Rationale**: Standard pattern — gives hot reload on the frontend while API runs separately. No CORS configuration needed.

### 4. Aggregate votes at query time

**Choice**: The `/api/elections/:id/results` endpoint runs a SQL query that sums votes across all sections grouped by party, joining with the parties table for names.

**Rationale**: The `votes` table has per-section rows. Aggregating in SQL is fast for 18 elections and avoids shipping raw section-level data to the client. SQLite handles this in milliseconds.

### 5. Read-only, no ORM

**Choice**: Use raw SQL via `better-sqlite3` with no ORM layer.

**Rationale**: Two simple read queries don't justify an ORM. `better-sqlite3` is synchronous and fast for reads. Keeps dependencies minimal.

## Risks / Trade-offs

- **[Risk] `elections.db` not found at runtime** -> Mitigation: Server checks for DB at startup and logs a clear error. Document that the DB must exist at repo root.
- **[Risk] Large result sets on elections with many parties** -> Mitigation: Acceptable for now — even the largest election has ~30 parties. Pagination is a non-goal.
- **[Trade-off] No production build/deploy** -> Keeps scope minimal but means this is dev-only until a follow-up change adds Cloudflare Workers config.
