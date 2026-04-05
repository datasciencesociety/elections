## ADDED Requirements

### Requirement: Filter election results by geographic level
The API SHALL accept optional query parameters on `GET /api/elections/:id/results` to filter vote aggregation by a single geographic level. Supported parameters: `rik`, `district`, `municipality`, `kmetstvo`, `local_region`. Each parameter value SHALL be the integer ID of the corresponding geographic entity. When no filter parameter is provided, the endpoint SHALL return national totals (existing behavior). When multiple filter parameters are provided, the most specific one SHALL take precedence in order: kmetstvo > local_region > municipality > district > rik.

#### Scenario: Filter results by municipality
- **WHEN** a client sends `GET /api/elections/:id/results?municipality=42`
- **THEN** the response SHALL contain party vote totals aggregated only from sections whose location is linked to municipality ID 42

#### Scenario: Filter results by RIK
- **WHEN** a client sends `GET /api/elections/:id/results?rik=1`
- **THEN** the response SHALL contain party vote totals aggregated only from sections whose location has rik_id = 1

#### Scenario: Filter results by district
- **WHEN** a client sends `GET /api/elections/:id/results?district=5`
- **THEN** the response SHALL contain party vote totals aggregated only from sections whose location has district_id = 5

#### Scenario: Filter results by kmetstvo
- **WHEN** a client sends `GET /api/elections/:id/results?kmetstvo=100`
- **THEN** the response SHALL contain party vote totals aggregated only from sections whose location has kmetstvo_id = 100

#### Scenario: Filter results by local region
- **WHEN** a client sends `GET /api/elections/:id/results?local_region=3`
- **THEN** the response SHALL contain party vote totals aggregated only from sections whose location has local_region_id = 3

#### Scenario: No filter returns national totals
- **WHEN** a client sends `GET /api/elections/:id/results` with no geographic query parameters
- **THEN** the response SHALL return the same national totals as the current unfiltered behavior

#### Scenario: Multiple filters use most specific
- **WHEN** a client sends `GET /api/elections/:id/results?district=5&municipality=42`
- **THEN** the endpoint SHALL filter by municipality (the more specific level), ignoring the district parameter

#### Scenario: Invalid geographic ID returns empty results
- **WHEN** a client sends `GET /api/elections/:id/results?rik=9999` where RIK 9999 does not exist
- **THEN** the response SHALL return the election object with an empty results array

### Requirement: List geographic entities
The API SHALL provide endpoints to list available geographic entities for populating filter controls. Each entity SHALL include at least `id` and `name` fields.

#### Scenario: List all RIKs
- **WHEN** a client sends `GET /api/geography/riks`
- **THEN** the response SHALL return an array of all RIK objects with `id` and `name` fields

#### Scenario: List all districts
- **WHEN** a client sends `GET /api/geography/districts`
- **THEN** the response SHALL return an array of all district objects with `id` and `name` fields

#### Scenario: List municipalities with optional district filter
- **WHEN** a client sends `GET /api/geography/municipalities?district=5`
- **THEN** the response SHALL return only municipalities belonging to district 5

#### Scenario: List all municipalities without filter
- **WHEN** a client sends `GET /api/geography/municipalities` with no query parameters
- **THEN** the response SHALL return all municipalities

#### Scenario: List kmetstva with optional municipality filter
- **WHEN** a client sends `GET /api/geography/kmetstva?municipality=42`
- **THEN** the response SHALL return only kmetstva belonging to municipality 42

#### Scenario: List local regions with optional municipality filter
- **WHEN** a client sends `GET /api/geography/local-regions?municipality=42`
- **THEN** the response SHALL return only local regions belonging to municipality 42

### Requirement: Cascading location filter UI
The election results page SHALL display a filter bar with dropdown selects for each geographic level. Selecting a higher-level geography SHALL narrow the options in child-level dropdowns. Changing any filter SHALL re-fetch and display filtered results.

#### Scenario: User selects a district
- **WHEN** a user selects a district from the district dropdown
- **THEN** the municipality dropdown SHALL update to show only municipalities in that district, and results SHALL update to show only votes from that district

#### Scenario: User selects a municipality after district
- **WHEN** a user has selected a district and then selects a municipality
- **THEN** the results SHALL update to show only votes from that municipality, and kmetstva/local region dropdowns SHALL populate with entities from that municipality

#### Scenario: User clears all filters
- **WHEN** a user resets the filter to the default (no selection)
- **THEN** the results SHALL return to showing national totals

### Requirement: Shareable filtered URLs
The active geographic filter SHALL be reflected in the page URL as query parameters so that filtered views are bookmarkable and shareable.

#### Scenario: Filter state in URL
- **WHEN** a user selects municipality 42 as a filter
- **THEN** the browser URL SHALL update to include `?municipality=42`

#### Scenario: Load page with filter in URL
- **WHEN** a user navigates to an election results page with `?district=5` in the URL
- **THEN** the district dropdown SHALL be pre-selected to district 5 and results SHALL show filtered data for that district
