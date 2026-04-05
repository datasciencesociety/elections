## Why

The platform scores every polling section on statistical anomaly indicators (turnout z-scores, Benford's law deviation, peer vote deviation, arithmetic errors) but provides no way to browse or visualize these scores. Journalists, researchers, and civic monitors need to identify suspicious sections quickly — filtering by risk level, sorting by specific metrics, and seeing geographic clusters on a map. Without this, the `section_scores` table is invisible to end users and the scoring pipeline delivers no actionable value.

## What Changes

- Add a new `GET /api/elections/:id/anomalies` endpoint that joins `section_scores`, `sections`, and `locations` to return scored sections with geographic metadata, supporting risk threshold filtering, geographic filters, column sorting, and pagination.
- Add a new frontend page at `/elections/:id/anomalies` with a risk threshold slider, geographic filters (reusing `LocationFilter`), a sortable data table, and a map view using mapcn (MapLibre GL) with color-coded markers.
- Add navigation links to the anomaly viewer from both the election list and election detail pages.
- No changes to `elections.db` schema — `section_scores` already contains all required data.

## Capabilities

### New Capabilities
- `section-anomaly-viewer`: API endpoint and frontend page for browsing anomaly-scored polling sections with table/map views, risk filtering, geographic filtering, sorting, and pagination.

### Modified Capabilities

## Impact

- **API** (`server/src/routes/elections.ts`): New `/api/elections/:id/anomalies` route with query params for `min_risk`, geographic filters, `sort`, `order`, `limit`, `offset`. Returns scored sections with location metadata and pagination info.
- **Frontend** (`web/src/pages/section-anomalies.tsx`): New page with risk slider, LocationFilter, sortable table, and mapcn map view with color-coded markers and popups.
- **Dependencies** (`web/package.json`): Add `maplibre-gl` (via mapcn component installation). Add Tailwind CSS and shadcn/ui as prerequisites for mapcn.
- **Database schema**: No changes. Existing `section_scores` table contains all anomaly metrics.
- **Performance**: Queries use the existing `section_scores` primary key index. Map view fetches up to 500 sections in a separate request to avoid pagination limits.
