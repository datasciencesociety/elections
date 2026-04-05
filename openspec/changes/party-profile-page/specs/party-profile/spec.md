## ADDED Requirements

### Requirement: Party detail API endpoint
The system SHALL expose `GET /api/parties/:id` returning the party's metadata, coalition relationships, and per-election results.

The response SHALL include:
- Party fields: `id`, `canonical_name`, `short_name`, `party_type`, `color`, `wiki_url`
- `coalitions`: array of coalitions this party belongs to (from `coalition_members` where `member_party_id = :id`), each with `id`, `canonical_name`, `color`
- `members`: array of member parties if this party is a coalition (from `coalition_members` where `coalition_id = :id`), each with `id`, `canonical_name`, `color`
- `elections`: array of per-election results sorted by election date descending, each with `election_id`, `election_name`, `election_date`, `election_type`, `votes`, `percentage`, `ballot_number`, `name_on_ballot`

Percentage SHALL be computed as party votes / total valid votes for that election, rounded to one decimal place.

#### Scenario: Retrieve existing party
- **WHEN** a GET request is made to `/api/parties/1`
- **THEN** the response status SHALL be 200 and the body SHALL contain the party's metadata, coalition info, and election history

#### Scenario: Party not found
- **WHEN** a GET request is made to `/api/parties/99999`
- **THEN** the response status SHALL be 404 with an error message

#### Scenario: Coalition party shows members
- **WHEN** a GET request is made for a party with `party_type = 'coalition'`
- **THEN** the `members` array SHALL contain all member parties from `coalition_members`

#### Scenario: Regular party shows coalition membership
- **WHEN** a GET request is made for a party that is a member of one or more coalitions
- **THEN** the `coalitions` array SHALL list those coalitions

### Requirement: Party profile page displays metadata
The system SHALL render a party profile page at `/parties/:id` showing the party's canonical name, short name, party type, and color indicator.

If `wiki_url` is present, the page SHALL display a link to the Wikipedia article. If `color` is present, the page SHALL display a color swatch.

#### Scenario: Full metadata displayed
- **WHEN** a user navigates to `/parties/:id` for a party with all metadata fields populated
- **THEN** the page SHALL show the canonical name as heading, short name, party type badge, color swatch, and Wikipedia link

#### Scenario: Missing optional fields
- **WHEN** a user navigates to `/parties/:id` for a party with null `color` and null `wiki_url`
- **THEN** the page SHALL still render without errors, omitting the color swatch and Wikipedia link

### Requirement: Party profile page displays coalition relationships
The party profile page SHALL display coalition relationships: which coalitions the party belongs to, and (if it is a coalition) which parties are its members. Each related party SHALL link to its own profile page.

#### Scenario: Coalition with members
- **WHEN** a user views a coalition party's profile
- **THEN** the page SHALL list all member parties with links to `/parties/:member_id`

#### Scenario: Party belonging to coalitions
- **WHEN** a user views a party that is a member of coalitions
- **THEN** the page SHALL list the coalitions with links to `/parties/:coalition_id`

#### Scenario: Party with no coalition relationships
- **WHEN** a user views a party that has no coalition entries
- **THEN** the coalition section SHALL be hidden or show an empty state

### Requirement: Party profile page displays historical results table
The party profile page SHALL display a table of the party's results across all elections it participated in, sorted by election date descending. Each row SHALL show: election name (linked to `/elections/:election_id`), election date, ballot number, name on ballot, total votes, and vote percentage.

#### Scenario: Party with multiple elections
- **WHEN** a user views a party that participated in 5 elections
- **THEN** the table SHALL show 5 rows sorted by date descending

#### Scenario: Party with single election
- **WHEN** a user views a party that participated in only 1 election
- **THEN** the table SHALL show 1 row

### Requirement: Party profile page displays trend chart
The party profile page SHALL display a Chart.js line chart showing the party's vote percentage over time. The x-axis SHALL show election dates, the y-axis SHALL show percentage. The line color SHALL use the party's `color` field, falling back to a default gray (#888888) if null.

The chart SHALL only be displayed if the party participated in 2 or more elections.

#### Scenario: Party with multiple elections shows chart
- **WHEN** a user views a party that participated in 3+ elections
- **THEN** a line chart SHALL be displayed with data points for each election

#### Scenario: Party with single election hides chart
- **WHEN** a user views a party that participated in only 1 election
- **THEN** the trend chart SHALL NOT be displayed

### Requirement: Election results link to party profiles
On the election results page (`/elections/:id`), each party name in the results table SHALL be a clickable link to `/parties/:party_id`.

#### Scenario: Clicking party name navigates to profile
- **WHEN** a user clicks a party name in the election results table
- **THEN** the browser SHALL navigate to `/parties/:party_id`
