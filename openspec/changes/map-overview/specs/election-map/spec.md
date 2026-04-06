## ADDED Requirements

### Requirement: Map page renders a full-screen choropleth of Bulgaria colored by winning party
The system SHALL display a MapLibre GL map at route `/map/:electionId` showing all municipalities as filled polygons colored by the winning party's color.

#### Scenario: Initial map render
- **WHEN** user navigates to `/map/1`
- **THEN** the page displays a full-screen MapLibre GL map centered on Bulgaria (approximately lat 42.7, lng 25.5)
- **AND** each municipality polygon is filled with the `color` of its winning party
- **AND** municipalities with no votes are filled with a neutral gray color (#CCCCCC)

#### Scenario: Map shows election name
- **WHEN** user navigates to `/map/1`
- **THEN** the page displays the election name (e.g., "Парламентарни избори 27.10.2024") as a title overlay on the map

### Requirement: Clicking a municipality shows a popup with party vote breakdown
The system SHALL display a popup when a user clicks on a municipality polygon showing the municipality name, total votes, and per-party vote breakdown.

#### Scenario: Click on a municipality with votes
- **WHEN** user clicks on the polygon for municipality "Банско"
- **AND** "Банско" has total_votes of 5200 with 3 parties
- **THEN** a popup appears showing the municipality name "Банско"
- **AND** the popup shows total votes: 5200
- **AND** the popup lists each party with its name, color indicator, vote count, and percentage, sorted by votes descending

#### Scenario: Click on a municipality with no votes
- **WHEN** user clicks on a municipality polygon that has no votes (winner is null)
- **THEN** a popup appears showing the municipality name
- **AND** the popup shows "No vote data for this election"

#### Scenario: Clicking elsewhere dismisses the popup
- **WHEN** a municipality popup is currently displayed
- **AND** user clicks on an area outside any municipality polygon
- **THEN** the popup is dismissed

### Requirement: Election selector allows switching between elections
The system SHALL display a dropdown selector that lists all available elections and allows the user to switch the displayed election without leaving the map page.

#### Scenario: Election dropdown lists all elections
- **WHEN** user navigates to `/map/1`
- **THEN** a dropdown is visible in the top-right area of the map
- **AND** the dropdown contains all elections from the system, ordered by date descending
- **AND** the current election (id=1) is selected by default

#### Scenario: Switching election reloads map data
- **WHEN** user selects a different election (id=2) from the dropdown
- **THEN** the URL updates to `/map/2`
- **AND** the map re-renders with municipality colors reflecting election 2's winning parties
- **AND** any open popup is dismissed

### Requirement: Map page shows loading state while fetching data
The system SHALL display a loading indicator while the geo results API response is being fetched.

#### Scenario: Loading state on initial page load
- **WHEN** user navigates to `/map/1`
- **AND** the geo results API has not yet responded
- **THEN** a loading indicator is displayed

#### Scenario: Loading state on election switch
- **WHEN** user switches to a different election via the dropdown
- **AND** the new data has not yet loaded
- **THEN** a loading indicator is displayed
- **AND** the previous map data remains visible (no blank flash)

### Requirement: Map page shows error state for invalid election
The system SHALL display an error message if the geo results API returns an error.

#### Scenario: Non-existent election ID in URL
- **WHEN** user navigates to `/map/99999`
- **AND** the API returns 404
- **THEN** the page displays an error message "Election not found"
- **AND** the election selector dropdown is still functional

### Requirement: Map page is accessible from election list and election detail pages
The system SHALL provide navigation links to the map page from existing pages.

#### Scenario: Map link on election list page
- **WHEN** user views the election list page at `/`
- **THEN** each election entry has a "Map" link that navigates to `/map/:electionId`

#### Scenario: Map link on election detail page
- **WHEN** user views an election detail page at `/elections/:id`
- **THEN** the page contains a "Map" link that navigates to `/map/:id`

### Requirement: Map route is registered in the application router
The system SHALL register `/map/:electionId` as a route rendering the `ElectionMap` component.

#### Scenario: Direct URL navigation
- **WHEN** user navigates directly to `/map/1` via browser URL bar
- **THEN** the election map page renders correctly for election 1

#### Scenario: Unknown route still shows 404
- **WHEN** user navigates to `/map/` without an election ID
- **THEN** the route does not match and the application handles it as an unmatched route
