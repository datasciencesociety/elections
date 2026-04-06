## ADDED Requirements

### Requirement: Geo results endpoint returns municipality-level aggregated vote results with geometry
The system SHALL expose `GET /api/elections/:id/results/geo` that returns all municipalities with aggregated vote totals, winning party, party breakdown, and GeoJSON geometry for the specified election.

#### Scenario: Successful response for a valid election
- **WHEN** client sends `GET /api/elections/1/results/geo`
- **THEN** the response status is 200
- **AND** the response contains an `election` object with `id`, `name`, `date`, and `type`
- **AND** the response contains a `municipalities` array with one entry per municipality that has vote data
- **AND** each municipality entry has `id`, `name`, `geo`, `total_votes`, `winner`, and `parties`

#### Scenario: Municipality entry structure
- **WHEN** client sends `GET /api/elections/1/results/geo`
- **THEN** each municipality in the response has `geo` containing a GeoJSON geometry object with `type` and `coordinates`
- **AND** each municipality has `total_votes` as the sum of all party votes in that municipality
- **AND** each municipality has a `parties` array sorted by `votes` descending, where each entry has `party_id`, `name`, `color`, `votes`, and `pct`
- **AND** `pct` equals `ROUND(votes / total_votes * 100, 2)` for each party

#### Scenario: Winner is the party with the most votes
- **WHEN** client sends `GET /api/elections/1/results/geo`
- **THEN** each municipality's `winner` object has `party_id`, `name`, `color`, `votes`, and `pct` matching the party with the highest vote total in that municipality

#### Scenario: Municipality with no votes has null winner
- **WHEN** a municipality has no vote records for the specified election
- **THEN** that municipality is included in the response with `total_votes` of 0, `winner` of `null`, and an empty `parties` array

### Requirement: Geo results endpoint returns 404 for unknown election
The system SHALL return 404 when the election ID does not exist in the database.

#### Scenario: Non-existent election ID
- **WHEN** client sends `GET /api/elections/99999/results/geo`
- **THEN** the response status is 404
- **AND** the response body contains an error message indicating the election was not found

### Requirement: Geo results endpoint returns 400 for invalid election ID
The system SHALL return 400 when the election ID is not a valid number.

#### Scenario: Non-numeric election ID
- **WHEN** client sends `GET /api/elections/abc/results/geo`
- **THEN** the response status is 400
- **AND** the response body contains an error message indicating the ID must be numeric

### Requirement: Geo results endpoint includes all municipalities with geometry
The system SHALL include every municipality that has a non-null `geo` column in the response, even if it has no votes for the given election, so the choropleth map can render complete geographic coverage.

#### Scenario: All municipalities with geometry are included
- **WHEN** client sends `GET /api/elections/1/results/geo`
- **THEN** the `municipalities` array contains an entry for every municipality in the database that has a non-null `geo` value
- **AND** municipalities without votes for election 1 have `total_votes` of 0 and `winner` of `null`

### Requirement: Geo results endpoint aggregates votes across all sections within a municipality
The system SHALL sum votes across all polling sections within each municipality by joining `votes → sections → locations → municipalities`.

#### Scenario: Multi-section municipality aggregation
- **WHEN** municipality "Благоевград" (id=3) has 15 polling sections for election 1
- **AND** client sends `GET /api/elections/1/results/geo`
- **THEN** the entry for municipality id=3 has `total_votes` equal to the sum of all votes across all 15 sections
- **AND** each party's `votes` in the `parties` array equals the sum of that party's votes across all 15 sections

### Requirement: Geo results endpoint resolves party names and colors from canonical parties table
The system SHALL join through `election_parties` and `parties` to return `parties.canonical_name` as `name` and `parties.color` as `color` for each party in the breakdown.

#### Scenario: Party name and color resolution
- **WHEN** election 1 has party with ballot_number=7 mapped to party_id=10 in `election_parties`
- **AND** party_id=10 has `canonical_name` "ГЕРБ-СДС" and `color` "#0055A2" in the `parties` table
- **AND** client sends `GET /api/elections/1/results/geo`
- **THEN** the party entry in each municipality's `parties` array shows `name` as "ГЕРБ-СДС" and `color` as "#0055A2"
