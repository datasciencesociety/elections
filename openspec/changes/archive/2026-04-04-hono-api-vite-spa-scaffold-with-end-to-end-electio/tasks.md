## 1. Project Setup

- [x] 1.1 Create root `package.json` with npm workspaces (`server/`, `web/`)
- [x] 1.2 Create `server/package.json` with dependencies: `hono`, `better-sqlite3`, `@hono/node-server`
- [x] 1.3 Create `web/package.json` with dependencies: `react`, `react-dom`, `react-router`, `vite`, `@vitejs/plugin-react`
- [x] 1.4 Add TypeScript config files (`tsconfig.json`) for both server and web
- [x] 1.5 Validate setup by running `npm install` successfully from root

## 2. API Server

- [x] 2.1 Create `server/src/db.ts` — open `elections.db` with `better-sqlite3`, export db instance with startup check
- [x] 2.2 Create `server/src/routes/elections.ts` — implement `GET /api/elections` returning list of elections (id, name, date, type)
- [x] 2.3 Implement `GET /api/elections/:id/results` in the same routes file — sum votes per party with party names, sorted by total votes descending
- [x] 2.4 Create `server/src/index.ts` — Hono app mounting election routes, serving Vite build output for non-API routes
- [x] 2.5 Validate API by starting server and confirming both endpoints return correct JSON against `elections.db`

## 3. SPA Frontend

- [x] 3.1 Create `web/vite.config.ts` with React plugin and `/api` proxy to Hono dev server
- [x] 3.2 Create `web/index.html` entry point and `web/src/main.tsx` with React Router setup
- [x] 3.3 Create `web/src/pages/election-list.tsx` — fetch and display elections as clickable links
- [x] 3.4 Create `web/src/pages/election-results.tsx` — fetch and display votes per party in an HTML table with election name heading
- [x] 3.5 Add loading and error states to both pages

## 4. Dev Workflow and End-to-End Validation

- [x] 4.1 Add root `dev` script that starts Hono server and Vite dev server concurrently
- [x] 4.2 Add root `build` script that builds the Vite SPA
- [x] 4.3 End-to-end validation: start dev, load SPA in browser, confirm election list loads from API, click an election, confirm results table renders with party names and vote totals
