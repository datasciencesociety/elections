## ADDED Requirements

### Requirement: Turnout endpoint returns aggregated voter turnout by geographic group
The system SHALL expose `GET /api/elections/:id/turnout` that returns voter turnout data aggregated by a specified geographic level, computed from the `protocols` table's `registered_voters` and `actual_voters` columns.

#### Scenario: Turnout grouped by district
- **WHEN** client sends `GET /api/elections/1/turnout?group_by=district`
- **THEN** the response contains an `election` object with `id`, `name`, `date`, and `type`
- **AND** the response contains a `turnout` array where each item has `group_id`, `group_name`, `registered_voters`, `actual_voters`, and `turnout_pct`
- **AND** `turnout_pct` equals `ROUND(actual_voters / registered_voters * 100, 2)` for each group
- **AND** the response contains a `totals` object with overall `registered_voters`, `actual_voters`, and `turnout_pct`

#### Scenario: Turnout grouped by municipality
- **WHEN** client sends `GET /api/elections/1/turnout?group_by=municipality`
- **THEN** the response contains a `turnout` array grouped by municipality with one entry per municipality

### Requirement: Turnout endpoint requires group_by parameter
The system SHALL return a 400 error if the `group_by` query parameter is missing or contains an invalid value.

#### Scenario: Missing group_by parameter
- **WHEN** client sends `GET /api/elections/1/turnout` without `group_by`
- **THEN** the response status is 400
- **AND** the response body contains an error message indicating `group_by` is required

#### Scenario: Invalid group_by value
- **WHEN** client sends `GET /api/elections/1/turnout?group_by=country`
- **THEN** the response status is 400
- **AND** the response body contains an error message listing valid values: `rik`, `district`, `municipality`, `kmetstvo`, `local_region`

### Requirement: Turnout endpoint supports geographic filtering
The system SHALL accept geographic filter query parameters (`rik`, `district`, `municipality`, `kmetstvo`, `local_region`) to narrow the scope of turnout data, using the same filtering logic as existing endpoints where the most specific filter wins.

#### Scenario: Filter by district
- **WHEN** client sends `GET /api/elections/1/turnout?group_by=municipality&district=1`
- **THEN** the response contains turnout data only for municipalities within district 1

#### Scenario: Multiple geographic filters with most-specific wins
- **WHEN** client sends `GET /api/elections/1/turnout?group_by=municipality&district=1&municipality=5`
- **THEN** the response contains turnout data only for municipality 5 (most specific filter wins)

### Requirement: Turnout endpoint handles null and zero values gracefully
The system SHALL use `COALESCE` to treat NULL `registered_voters` or `actual_voters` as 0, and SHALL return `turnout_pct` as 0 when `registered_voters` is 0 to avoid division by zero.

#### Scenario: Section with zero registered voters
- **WHEN** a geographic group has `registered_voters` summing to 0
- **THEN** `turnout_pct` for that group is 0.0 (not an error or NaN)

#### Scenario: Section with null protocol values
- **WHEN** a section has NULL `registered_voters` or `actual_voters`
- **THEN** the NULL values are treated as 0 in the aggregation

### Requirement: Turnout endpoint returns 404 for unknown election
The system SHALL return 404 when the election ID does not exist in the database.

#### Scenario: Non-existent election ID
- **WHEN** client sends `GET /api/elections/99999/turnout?group_by=district`
- **THEN** the response status is 404
- **AND** the response body contains an error message indicating the election was not found
