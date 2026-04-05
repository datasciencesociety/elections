## ADDED Requirements

### Requirement: Turnout page accessible via route
The system SHALL render a turnout dashboard page at the `/turnout/:id` route, where `:id` is the election ID.

#### Scenario: Navigate to turnout page
- **WHEN** user navigates to `/turnout/1`
- **THEN** the turnout dashboard page is rendered with data for election ID 1

#### Scenario: Link from election list
- **WHEN** user views the election list page
- **THEN** each election has a link or button to navigate to its turnout page

### Requirement: Group-by selector controls aggregation level
The system SHALL display a dropdown to select the geographic grouping level (`district`, `municipality`, `rik`, `kmetstvo`, `local_region`) with `district` as the default.

#### Scenario: Default grouping is district
- **WHEN** user opens the turnout page without changing any controls
- **THEN** the bar chart shows turnout data grouped by district

#### Scenario: Change grouping to municipality
- **WHEN** user selects `municipality` from the group-by dropdown
- **THEN** the bar chart updates to show turnout data grouped by municipality

### Requirement: Horizontal bar chart displays turnout percentage
The system SHALL render a horizontal bar chart using `react-chartjs-2` showing turnout percentage for each geographic unit in the selected grouping.

#### Scenario: Bar chart renders with correct data
- **WHEN** the turnout API returns data for 5 districts
- **THEN** the bar chart displays 5 horizontal bars labeled with district names
- **AND** each bar's length corresponds to its `turnout_pct` value
- **AND** the x-axis represents percentage (0–100%)

#### Scenario: Bar chart sorts by turnout descending
- **WHEN** the turnout data is loaded
- **THEN** the bars are sorted by turnout percentage in descending order by default

### Requirement: Summary card shows overall turnout
The system SHALL display a summary card showing the total `registered_voters`, `actual_voters`, and `turnout_pct` from the API's `totals` field.

#### Scenario: Summary card displays totals
- **WHEN** the turnout page loads successfully
- **THEN** a summary card shows the total registered voters, actual voters, and overall turnout percentage

### Requirement: Geographic drill-down via LocationFilter
The system SHALL include the existing `LocationFilter` component to allow users to filter turnout data by geographic area, passing the selected filters as query parameters to the API.

#### Scenario: Filter by district using LocationFilter
- **WHEN** user selects a district in the LocationFilter component
- **THEN** the API is called with the `district` filter parameter
- **AND** the bar chart updates to show only data within the selected district

### Requirement: Loading and error states
The system SHALL show a loading indicator while fetching turnout data and an error message if the API request fails.

#### Scenario: Loading state
- **WHEN** the turnout API request is in progress
- **THEN** a loading indicator is displayed

#### Scenario: API error
- **WHEN** the turnout API returns an error
- **THEN** an error message is displayed to the user

#### Scenario: Election not found
- **WHEN** the turnout API returns 404
- **THEN** a message is displayed indicating the election was not found
