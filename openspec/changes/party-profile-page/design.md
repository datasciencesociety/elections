## Context

The platform currently provides election-centric views (results, turnout, comparison) but no party-centric navigation. The `parties` table already stores metadata including `color` and `wiki_url`, and `coalition_members` tracks coalition composition — but neither is surfaced in the UI. Adding party profile and list pages fills this gap, enabling cross-election analysis from a party's perspective.

The existing stack is Hono (API) + React + Chart.js (frontend), with better-sqlite3 for local dev and static JSON on R2 for prod. The compare elections page already establishes the pattern for multi-election Chart.js visualizations.

## Goals / Non-Goals

**Goals:**
- Let users view any party's metadata, coalition relationships, and historical election performance
- Provide a browsable/searchable party index
- Link election results to party profiles for seamless navigation
- Reuse existing Chart.js infrastructure for trend visualization

**Non-Goals:**
- Geographic breakdown per party (future enhancement — would require per-party map views)
- Candidate-level data on the party profile (preferences table is large; keep scope focused)
- Editing or enriching party metadata through the UI
- Full-text search or fuzzy matching for party names (simple substring filter is sufficient)

## Decisions

### 1. API structure: two endpoints under `/api/parties`

**Choice:** `GET /api/parties` (list) and `GET /api/parties/:id` (detail with history).

**Rationale:** Mirrors the `/api/elections` pattern. The list endpoint returns lightweight metadata (id, canonical_name, short_name, party_type, color). The detail endpoint does the heavier aggregation query joining `votes`, `election_parties`, and `protocols` to compute per-election totals and percentages. This keeps the list fast and the detail comprehensive.

**Alternative considered:** Single endpoint returning everything. Rejected because the list page doesn't need vote aggregation for ~270 parties, and the detail query involves multiple joins that would be wasteful in bulk.

### 2. Vote aggregation: server-side per-election totals

**Choice:** The `/api/parties/:id` endpoint returns an array of election results, each with `{ election_id, election_name, election_date, election_type, votes, percentage, ballot_number, name_on_ballot }`. Percentage is computed as party votes / total valid votes for that election.

**Rationale:** Matches how the compare endpoint already works. Computing percentages server-side avoids shipping raw vote totals for all parties to the client. The query groups by election and sums votes across all sections.

**Alternative considered:** Client-side aggregation from raw votes. Rejected — too much data transfer for 18+ elections.

### 3. Coalition data: inline in party detail response

**Choice:** The detail endpoint includes `coalitions` (coalitions this party belongs to) and `members` (if this party is a coalition, its member parties). Both are arrays of `{ id, canonical_name, color }`.

**Rationale:** Coalition membership is a small dataset (few rows per party). Embedding it avoids extra roundtrips. The bidirectional view (member→coalition and coalition→members) is natural for the UI.

### 4. Frontend routing: `/parties` and `/parties/:id`

**Choice:** Two new routes following existing kebab-case page component convention. Party list at `/parties`, party profile at `/parties/:id`.

**Rationale:** Consistent with `/elections/:id` pattern. Using the numeric `parties.id` as the URL parameter (not slug) matches how election routes work.

### 5. Trend chart: line chart with party color

**Choice:** A Chart.js line chart showing vote percentage across elections (x-axis: election date, y-axis: percentage). Uses the party's `color` field for the line/fill. Falls back to a default gray if color is null.

**Rationale:** Reuses the Chart.js dependency already in the project (used by compare-elections). A line chart is the most natural visualization for a single party's performance trend.

### 6. Linking from election results

**Choice:** In the election results page, wrap party names in `<Link to={`/parties/${party_id}`}>`. This requires the results API to continue returning `party_id`, which it already does.

**Rationale:** Minimal change — the data is already there, just needs the link wrapper.

### 7. Party list filtering

**Choice:** Client-side substring filter on canonical_name and short_name. Optional filter by `party_type` (party/coalition/initiative_committee).

**Rationale:** ~270 parties is small enough for client-side filtering. No need for server-side search or pagination.

## Risks / Trade-offs

- **[Performance] Aggregation query for parties that appear in many elections** → The detail query joins votes across all elections for one party. With 18 elections this is manageable. If the dataset grows to 50+ elections, may need to pre-aggregate or cache. Mitigation: the query filters by `party_id` via `election_parties`, hitting the `idx_ep_party` index.

- **[Data quality] Some parties have null color or missing wiki_url** → Mitigation: UI handles nulls gracefully (default gray color, no wiki link shown). ~180/270 parties have colors.

- **[UX] ~270 parties is a long list, many with zero or few votes** → Mitigation: sort by total votes across all elections (descending) so major parties appear first. Type filter helps narrow further.
