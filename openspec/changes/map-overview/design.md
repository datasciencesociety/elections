## Context

The platform has 18 elections with vote data at the polling-section level, linked through `sections → locations → municipalities`. Each municipality (265 total) has a GeoJSON polygon stored in the `municipalities.geo` column. Parties have assigned hex colors in `parties.color`. No geographic visualization currently exists — users navigate elections through tabular views only.

The proposal calls for a choropleth map colored by winning party per municipality, with click-to-drill-down showing party breakdowns, and an election selector to switch elections without leaving the map.

## Goals / Non-Goals

**Goals:**
- API endpoint returning municipality-level aggregated vote results with GeoJSON geometry and winning party metadata
- Full-screen MapLibre GL choropleth map page colored by each municipality's winning party color
- Click interaction showing party-level vote breakdown per municipality
- Election selector to switch between elections on the map page
- Navigation integration from existing election list/detail pages

**Non-Goals:**
- Section-level (polling station) map markers — municipalities only for this feature
- Custom tile server or self-hosted map tiles — use public tile sources
- Vote heatmaps, gradients, or proportional coloring — only winning-party choropleth
- Offline map support or map export/download
- Changes to the database schema

## Decisions

### 1. API shape: `GET /api/elections/:id/results/geo`

Returns all 265 municipalities with aggregated vote data and GeoJSON geometry for the specified election. No pagination — the full dataset is small enough (~265 rows) to return in one response.

**Response structure:**
```json
{
  "election": { "id": 1, "name": "...", "date": "...", "type": "..." },
  "municipalities": [
    {
      "id": 1,
      "name": "Банско",
      "geo": { "coordinates": [...], "type": "Polygon" },
      "total_votes": 5200,
      "winner": {
        "party_id": 10,
        "name": "ГЕРБ-СДС",
        "color": "#0055A2",
        "votes": 1800,
        "pct": 34.62
      },
      "parties": [
        { "party_id": 10, "name": "ГЕРБ-СДС", "color": "#0055A2", "votes": 1800, "pct": 34.62 },
        { "party_id": 15, "name": "ПП-ДБ", "color": "#2B579A", "votes": 1200, "pct": 23.08 }
      ]
    }
  ]
}
```

**SQL approach:** Aggregate `votes` by municipality via `votes → sections → locations → municipalities` join. Join `election_parties` and `parties` to get `canonical_name` and `color`. Group by `municipality_id, party_number`, then in application code determine the winner (party with max total votes) and build the parties array per municipality.

**Alternative considered:** Returning raw GeoJSON FeatureCollection directly. Rejected — the response structure mirrors existing API conventions (election metadata + data array) and gives the frontend structured party data rather than forcing GeoJSON property parsing.

### 2. GeoJSON rendering: MapLibre GL with GeoJSON source

Use MapLibre GL's native GeoJSON source and fill layer for the choropleth rather than individual markers. The `municipalities.geo` column stores polygon coordinates directly — these are assembled into a GeoJSON FeatureCollection on the frontend and rendered as a single fill layer with `fill-color` driven by a data expression matching municipality ID to winning party color.

This approach renders 265 polygons efficiently in a single WebGL draw call. MapLibre's built-in event handling (`map.on('click', 'layer', ...)`) provides click-to-identify for the drill-down popup.

**Alternative considered:** Using mapcn's `MapMarker` components (as in the anomaly viewer). Rejected — markers are point-based and cannot fill municipal boundaries. Choropleth requires polygon fill layers, which are a core MapLibre GL capability.

### 3. Municipality popup: inline popup with party breakdown

On municipality click, show a MapLibre `Popup` anchored at the click coordinates displaying:
- Municipality name and total votes
- Bar chart or horizontal bars showing each party's vote share, colored by party color
- Party names, vote counts, and percentages

Use inline rendering within the popup (React portal or HTML string) to avoid external tooltip library dependencies.

### 4. Election selector: dropdown overlay

A `<select>` dropdown positioned in the top-right corner of the map (as a map overlay, not in the MapLibre controls) listing all elections by name and date. Changing the selection navigates to `/map/<newElectionId>` or re-fetches data for the new election. The dropdown fetches the election list from the existing `GET /api/elections` endpoint.

### 5. Route and navigation

- New route: `/map/:electionId` in `web/src/main.tsx`
- New page component: `web/src/pages/election-map.tsx`
- Navigation links: "Map" link added to the election list page and election detail page

## Risks / Trade-offs

- **Large GeoJSON payload** — 265 municipalities with full polygon geometry may produce a response of 5–15 MB. → Mitigation: The data is cacheable and loads once per election switch. Consider `Content-Encoding: gzip` at the server level (Hono supports compression middleware). If too large, a future optimization could serve pre-built static GeoJSON files.
- **Municipalities with zero votes** — Some municipalities may have no sections or votes for certain election types (e.g., local elections only cover specific areas). → Mitigation: Municipalities with no vote data are included in the response with `total_votes: 0`, `winner: null`, and empty `parties` array. The map renders them in a neutral gray color.
- **Party color collisions** — Two parties may share the same or very similar color, making adjacent municipalities hard to distinguish. → Mitigation: Accept for now; party colors come from the database and are established identifiers. Not worth overriding.
- **GeoJSON coordinate format** — The `municipalities.geo` column stores JSON with `coordinates` and `type` but no `properties` — it's the geometry portion only, not a full Feature. → Mitigation: The frontend wraps each geometry in a GeoJSON Feature with municipality properties before building the FeatureCollection.
