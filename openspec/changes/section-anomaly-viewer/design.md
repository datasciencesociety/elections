## Context

The database contains a `section_scores` table with per-section anomaly metrics: `risk_score` (composite 0–1), `turnout_rate`, `turnout_zscore`, `benford_score`, `peer_vote_deviation`, `arithmetic_error`, and `vote_sum_mismatch`. These scores are computed for every section across all 18 elections. The `sections` table links scores to `locations` (which has `settlement_name`, `lat`, `lng` and geographic hierarchy IDs). Currently no API endpoint or frontend page exposes this data. The platform uses Hono for the API server and React with inline styles for the frontend. The `openspec/config.yaml` specifies MapLibre GL as the mapping technology.

## Goals / Non-Goals

**Goals:**
- API endpoint returning scored sections with location metadata, filterable by risk threshold and geography, sortable by any metric column, paginated
- Sortable table view showing all anomaly metrics per section
- Map view using mapcn (built on MapLibre GL) with markers color-coded by risk score and click popups showing key metrics
- Toggle between table and map views
- Reuse existing `LocationFilter` component for geographic filtering
- Risk threshold slider to focus on high-risk sections

**Non-Goals:**
- Detailed per-section drill-down page (future feature)
- Editing or recalculating anomaly scores
- Exporting data to CSV or other formats
- Custom map tile sources or offline map support
- Changes to the database schema or scoring algorithm

## Decisions

### 1. API shape: `GET /api/elections/:id/anomalies`

Returns sections from `section_scores` joined with `sections` and `locations`. Query parameters:

| Param | Default | Description |
|-------|---------|-------------|
| `min_risk` | `0.3` | Minimum `risk_score` threshold (0–1) |
| `sort` | `risk_score` | Column to sort by (whitelisted) |
| `order` | `desc` | Sort direction (`asc` or `desc`) |
| `limit` | `50` | Results per page (max 500) |
| `offset` | `0` | Pagination offset |
| `rik`, `district`, `municipality`, `kmetstvo`, `local_region` | — | Geographic filters (same precedence as existing endpoints) |

**Response structure:**
```json
{
  "election": { "id": 1, "name": "...", "date": "..." },
  "sections": [
    {
      "section_code": "010100001",
      "settlement_name": "гр.Банско",
      "lat": 41.83,
      "lng": 23.48,
      "risk_score": 0.72,
      "turnout_rate": 0.89,
      "turnout_zscore": 3.2,
      "benford_score": 0.65,
      "peer_vote_deviation": 0.45,
      "arithmetic_error": 1,
      "vote_sum_mismatch": 0
    }
  ],
  "total": 234,
  "limit": 50,
  "offset": 0
}
```

**Sort column whitelist:** `risk_score`, `turnout_rate`, `turnout_zscore`, `benford_score`, `peer_vote_deviation`, `arithmetic_error`, `vote_sum_mismatch`, `section_code`, `settlement_name`.

**Alternative considered:** Separate endpoints for table vs map data. Rejected — same data shape serves both; the map view simply uses a higher limit (500) and ignores pagination controls.

### 2. Map library: mapcn (MapLibre GL)

Use mapcn — a component library built on MapLibre GL. This aligns with the project's `config.yaml` which specifies MapLibre GL as the frontend mapping technology. mapcn provides ready-to-use React map components installed via `npx shadcn@latest add @mapcn/map`.

**Prerequisites:** mapcn requires Tailwind CSS and shadcn/ui. These will be added to the web workspace as part of this feature.

**Alternative considered:** Leaflet + react-leaflet. Rejected per reviewer feedback — mapcn/MapLibre GL provides WebGL-accelerated rendering (better for 500+ markers), aligns with the project's stated stack, and integrates with modern component patterns.

### 3. Map view: markers with color-coded risk scores

Use mapcn's `Map`, `MapMarker`, `MarkerContent`, and `MarkerPopup` components from `@/components/ui/map`:

```tsx
import { Map, MapMarker, MarkerContent, MarkerPopup } from "@/components/ui/map";

<Map center={[25.5, 42.7]} zoom={7}>
  {sections.map((s) => (
    <MapMarker key={s.section_code} longitude={s.lng} latitude={s.lat}>
      <MarkerContent>
        <div className={`size-3 rounded-full border-2 border-white ${riskColor(s.risk_score)}`} />
      </MarkerContent>
      <MarkerPopup>
        <div>{s.section_code} — {s.settlement_name}</div>
        <div>Risk: {s.risk_score}</div>
      </MarkerPopup>
    </MapMarker>
  ))}
</Map>
```

Note: `MapMarker` is DOM-based, which works well for up to a few hundred markers. For the 500-marker limit this is acceptable.

Markers use three risk tiers (Tailwind classes):
- Green (`bg-green-500`): risk_score < 0.3
- Yellow (`bg-yellow-500`): risk_score 0.3–0.6
- Red (`bg-red-500`): risk_score > 0.6

Click popup shows: section code, settlement name, risk score, and top anomaly metrics. Map centers on Bulgaria (42.7°N, 25.5°E, zoom 7). Note: mapcn `center` takes `[lng, lat]` order.

The map view fetches up to 500 sections (separate API call with `limit=500`) to show a comprehensive geographic picture independent of the table's pagination state.

### 4. Frontend prerequisites: Tailwind CSS + shadcn/ui

Since mapcn requires Tailwind CSS and shadcn/ui, these will be set up in the web workspace. Existing components using inline styles will not be migrated — the new anomaly viewer page will use Tailwind classes while existing pages remain unchanged.

### 5. Risk threshold slider

Default threshold of 0.3 filters out low-risk sections. Range 0–1 with step 0.05. Changing the slider triggers a new API request. This lets users adjust sensitivity — lowering the threshold to see more sections or raising it to focus on the most suspicious.

### 6. Table sorting via API

Sort is handled server-side via SQL `ORDER BY` with whitelisted columns. This avoids loading all data client-side and keeps the implementation simple. Column headers are clickable to toggle sort column and direction.

## Risks / Trade-offs

- **Tailwind/shadcn prerequisite for mapcn** → Adds build configuration to the frontend. Scoped to the new page; existing inline-styled pages are not affected. This establishes infrastructure for future component library adoption.
- **500-section marker limit on map** → May miss some anomalous sections for elections with many high-risk sections. Mitigated by the risk threshold filter — raising `min_risk` reduces the set. A future enhancement could use clustering.
- **No marker clustering** → With 500 markers, some geographic areas may have overlapping markers. Acceptable for v1; MapLibre GL handles rendering efficiently via WebGL. Clustering can be added later.
- **MapLibre GL bundle size** → ~200KB gzipped. Larger than Leaflet but provides WebGL performance needed for marker-dense views. Only loaded on the anomaly page (code-split via React Router lazy loading if needed later).
