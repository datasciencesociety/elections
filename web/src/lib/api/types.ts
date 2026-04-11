/**
 * All API response types in one place.
 *
 * If a page or component needs a type from the API, import it from here —
 * never re-declare. The server defines the same shapes in
 * `server/src/queries/*.ts`; if you change one side, change both.
 */

// ---------- elections ----------

export interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

// ---------- anomalies ----------

export interface AnomalySection {
  section_code: string;
  settlement_name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  protocol_url: string | null;
  risk_score: number;
  turnout_rate: number;
  turnout_zscore: number;
  benford_chi2: number;
  benford_p: number;
  benford_score: number;
  ekatte_turnout_zscore: number;
  ekatte_turnout_zscore_norm: number;
  peer_vote_deviation: number;
  peer_vote_deviation_norm: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  protocol_violation_count: number;
  benford_risk: number;
  peer_risk: number;
  acf_risk: number;
  acf_turnout_outlier: number;
  acf_winner_outlier: number;
  acf_invalid_outlier: number;
  acf_multicomponent: number;
  acf_turnout_shift: number | null;
  acf_turnout_shift_norm: number;
  acf_party_shift: number | null;
  acf_party_shift_norm: number;
  section_type: string;
  registered_voters: number | null;
  actual_voters: number | null;
}

export interface AnomaliesResponse {
  election: Election;
  sections: AnomalySection[];
  total: number;
  limit: number | null;
  offset: number;
}

export type AnomalyMethodology =
  | "combined"
  | "benford"
  | "peer"
  | "acf"
  | "protocol";

// ---------- sections ----------

export interface SectionGeo {
  section_code: string;
  lat: number;
  lng: number;
  settlement_name: string;
  registered_voters: number;
  actual_voters: number;
  winner_party: string | null;
  winner_color: string;
  winner_pct: number;
  parties: { name: string; color: string; votes: number; pct: number }[];
}

export interface SectionsGeoResponse {
  election: Election;
  sections: SectionGeo[];
}

export interface SectionProtocol {
  registered_voters: number;
  actual_voters: number;
  received_ballots: number;
  added_voters: number;
  invalid_votes: number;
  null_votes: number;
  valid_votes: number;
  machine_count: number;
}

export interface SectionParty {
  name: string;
  short_name: string;
  color: string | null;
  votes: number;
  paper: number;
  machine: number;
  pct: number;
}

export interface SectionContext {
  municipality_name: string | null;
  rik_avg_turnout: number | null;
  ekatte_avg_turnout: number | null;
  ekatte_peer_count: number | null;
  municipality_avg_turnout: number | null;
  municipality_turnout_q3: number | null;
  prev_election: { id: number; name: string; date: string } | null;
  prev_turnout: number | null;
}

export interface SectionDetail {
  protocol: SectionProtocol;
  parties: SectionParty[];
  context: SectionContext;
}

// ---------- violations ----------

export interface ProtocolViolation {
  rule_id: string;
  description: string;
  expected_value: string | null;
  actual_value: string | null;
  severity: string;
}

export interface SectionViolationsResponse {
  section_code: string;
  violations: ProtocolViolation[];
}

// ---------- persistence ----------

export interface PersistenceSection {
  section_code: string;
  elections_present: number;
  elections_flagged: number;
  weighted_avg_risk: number;
  avg_risk: number;
  max_risk: number;
  total_violations: number;
  total_arith_errors: number;
  total_vote_mismatches: number;
  benford_flags: number;
  peer_flags: number;
  acf_flags: number;
  protocol_flags: number;
  avg_turnout: number;
  persistence_score: number;
  consistency: number;
  settlement_name: string | null;
  lat: number | null;
  lng: number | null;
  avg_registered: number;
  avg_voted: number;
}

export interface PersistenceResponse {
  sections: PersistenceSection[];
  total: number;
  limit: number;
  offset: number;
  elections_count: number;
  weights: Record<string, { name: string; weight: number }>;
}

export interface PersistenceHistoryEntry {
  election_id: number;
  election_name: string;
  election_date: string;
  election_type: string;
  risk_score: number;
  benford_risk: number;
  peer_risk: number;
  acf_risk: number;
  turnout_rate: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  protocol_violation_count: number;
  protocol_url: string | null;
}

export interface PersistenceHistoryResponse {
  section_code: string;
  elections: PersistenceHistoryEntry[];
}

// ---------- geo results ----------

export interface GeoArea {
  id: number;
  name: string;
  geo: GeoJSON.Geometry;
  centroid: { lat: number; lng: number } | null;
  registered_voters: number;
  actual_voters: number;
  non_voters: number;
  total_votes: number;
  winner: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  } | null;
  parties: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  }[];
}

export interface GeoMunicipalityLean {
  id: number;
  name: string;
  geo: GeoJSON.Geometry;
  total_votes: number;
  winner: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  } | null;
  parties: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  }[];
}

export interface GeoResultsResponse {
  election: Election;
  districts?: GeoArea[];
  municipalities?: GeoArea[];
  riks?: GeoArea[];
}

export interface GeoResultsLeanResponse {
  election: Election;
  municipalities: GeoMunicipalityLean[];
}

// ---------- geography lookups ----------

export interface GeoEntity {
  id: number;
  name: string;
}

export interface District extends GeoEntity {
  section_count: number;
}

export interface AbroadSummary {
  section_count: number;
  country_count: number;
}

// ---------- browse ----------

export interface BrowseLocation {
  location_id: number;
  settlement_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  section_count: number;
  section_code: string;
}

export interface DistrictBrowseLocation extends BrowseLocation {
  municipality_id: number | null;
  municipality_name: string | null;
}

export interface DistrictBrowseResponse {
  district: { id: number; name: string };
  locations: DistrictBrowseLocation[];
}

export interface AbroadBrowseLocation extends BrowseLocation {
  country: string;
  city: string;
}

export interface AbroadBrowseResponse {
  locations: AbroadBrowseLocation[];
}

export interface MissingCoordinatesLocation {
  id: number;
  settlement_name: string;
  address: string;
  ekatte: string;
  section_codes: string;
  section_count: number;
}

export interface MissingCoordinatesResponse {
  total: number;
  page: number;
  pages: number;
  locations: MissingCoordinatesLocation[];
}

// ---------- section siblings ----------

export interface SiblingSection {
  section_code: string;
  registered_voters: number | null;
  actual_voters: number | null;
  turnout_rate: number | null;
  winner_party: string | null;
  winner_color: string | null;
  winner_pct: number | null;
}

export interface SectionSiblingsResponse {
  location: {
    id: number;
    settlement_name: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
  };
  latest_election: {
    id: number;
    name: string;
    date: string;
    type: string;
  } | null;
  siblings: SiblingSection[];
}
