## ADDED Requirements

### Requirement: List all elections
The API SHALL expose a `GET /api/elections` endpoint that returns a JSON array of all elections in the database.

#### Scenario: Successful election list
- **WHEN** a client sends `GET /api/elections`
- **THEN** the response status is 200 and the body is a JSON array where each element contains at least `id`, `name`, `date`, and `type` fields

#### Scenario: Response matches database content
- **WHEN** a client sends `GET /api/elections`
- **THEN** the number of items in the response equals the number of rows in the `elections` table

### Requirement: Get election results by ID
The API SHALL expose a `GET /api/elections/:id/results` endpoint that returns aggregated votes per party for the given election.

#### Scenario: Successful results retrieval
- **WHEN** a client sends `GET /api/elections/:id/results` with a valid election ID
- **THEN** the response status is 200 and the body is a JSON object containing the election info and an array of party results, each with `party_name`, `party_number`, and `total_votes`

#### Scenario: Votes are aggregated across all sections
- **WHEN** a client sends `GET /api/elections/:id/results` for an election with multiple sections
- **THEN** each party's `total_votes` equals the sum of that party's votes across all sections in the `votes` table

#### Scenario: Election not found
- **WHEN** a client sends `GET /api/elections/:id/results` with an ID that does not exist in the database
- **THEN** the response status is 404 and the body contains an error message

### Requirement: JSON content type
The API SHALL return responses with `Content-Type: application/json`.

#### Scenario: Content type header
- **WHEN** a client sends a request to any `/api/*` endpoint
- **THEN** the response `Content-Type` header is `application/json`

### Requirement: Database connection at startup
The server SHALL open `elections.db` using `better-sqlite3` at startup and log an error if the file is not found.

#### Scenario: Database exists
- **WHEN** the server starts and `elections.db` exists at the expected path
- **THEN** the server starts successfully and serves API requests

#### Scenario: Database missing
- **WHEN** the server starts and `elections.db` does not exist at the expected path
- **THEN** the server logs an error message indicating the database file was not found
