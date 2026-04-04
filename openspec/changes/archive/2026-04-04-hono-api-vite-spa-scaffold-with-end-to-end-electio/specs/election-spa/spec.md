## ADDED Requirements

### Requirement: Election list page
The SPA SHALL display a page listing all elections fetched from the API.

#### Scenario: Elections load and display
- **WHEN** a user navigates to the root URL `/`
- **THEN** the page fetches `GET /api/elections` and displays each election's name, date, and type

#### Scenario: Each election links to its results
- **WHEN** the election list is displayed
- **THEN** each election entry is a clickable link that navigates to `/elections/:id`

### Requirement: Election results page
The SPA SHALL display an HTML table of votes per party for a single election.

#### Scenario: Results table renders
- **WHEN** a user navigates to `/elections/:id`
- **THEN** the page fetches `GET /api/elections/:id/results` and renders a table with columns for party name and total votes

#### Scenario: Results are sorted by votes descending
- **WHEN** the results table is displayed
- **THEN** rows are sorted by total votes in descending order (highest first)

#### Scenario: Election name shown as heading
- **WHEN** a user navigates to `/elections/:id`
- **THEN** the election name is displayed as a page heading above the results table

### Requirement: Client-side routing
The SPA SHALL use React Router for navigation between the election list and results pages without full page reloads.

#### Scenario: Navigation preserves SPA behavior
- **WHEN** a user clicks an election link on the list page
- **THEN** the browser navigates to the results page without a full page reload

#### Scenario: Direct URL access works
- **WHEN** a user directly navigates to `/elections/:id` via the browser address bar
- **THEN** the results page loads correctly (server handles SPA fallback)

### Requirement: Loading and error states
The SPA SHALL indicate loading and error states when fetching data from the API.

#### Scenario: Loading indicator
- **WHEN** the SPA is fetching data from the API
- **THEN** a loading indicator (text or spinner) is displayed

#### Scenario: Error display
- **WHEN** an API request fails
- **THEN** an error message is displayed to the user
