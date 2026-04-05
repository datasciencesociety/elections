## ADDED Requirements

### Requirement: Party list API endpoint
The system SHALL expose `GET /api/parties` returning all parties with metadata. Each entry SHALL include: `id`, `canonical_name`, `short_name`, `party_type`, `color`, `election_count` (number of elections the party participated in), and `total_votes` (sum of votes across all elections).

Results SHALL be sorted by `total_votes` descending.

An optional `type` query parameter SHALL filter by `party_type` (accepted values: `party`, `coalition`, `initiative_committee`).

#### Scenario: List all parties
- **WHEN** a GET request is made to `/api/parties`
- **THEN** the response SHALL contain all parties sorted by total votes descending

#### Scenario: Filter by party type
- **WHEN** a GET request is made to `/api/parties?type=coalition`
- **THEN** the response SHALL contain only parties with `party_type = 'coalition'`

#### Scenario: Invalid type filter
- **WHEN** a GET request is made to `/api/parties?type=invalid`
- **THEN** the response status SHALL be 400 with an error message

### Requirement: Party list page
The system SHALL render a party list page at `/parties` displaying all parties in a table. Each row SHALL show: party name (linked to `/parties/:id`), short name, party type, color swatch, number of elections, and total votes.

#### Scenario: View party list
- **WHEN** a user navigates to `/parties`
- **THEN** a table of all parties SHALL be displayed, sorted by total votes descending

#### Scenario: Party name links to profile
- **WHEN** a user clicks a party name in the list
- **THEN** the browser SHALL navigate to `/parties/:id`

### Requirement: Party list client-side filtering
The party list page SHALL provide a text input for filtering parties by name (substring match on canonical_name or short_name, case-insensitive) and a dropdown for filtering by party type.

#### Scenario: Filter by name
- **WHEN** a user types "ГЕРБ" in the search input
- **THEN** only parties whose canonical_name or short_name contains "ГЕРБ" SHALL be shown

#### Scenario: Filter by type dropdown
- **WHEN** a user selects "coalition" from the type dropdown
- **THEN** only parties with `party_type = 'coalition'` SHALL be shown

#### Scenario: Combined filters
- **WHEN** a user types a name and selects a type
- **THEN** both filters SHALL apply simultaneously

### Requirement: Navigation to party list
The application SHALL include a navigation link to the party list page (`/parties`) accessible from the election list page.

#### Scenario: Navigate from home to party list
- **WHEN** a user is on the election list page
- **THEN** a link or button to `/parties` SHALL be visible and functional
