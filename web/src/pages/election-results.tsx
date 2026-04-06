import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import LocationFilter from "../components/location-filter.js";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

interface PartyResult {
  party_id: number;
  party_name: string;
  total_votes: number;
}

interface ResultsResponse {
  election: Election;
  results: PartyResult[];
}

const GEO_PARAMS = ["rik", "district", "municipality", "kmetstvo", "local_region"] as const;

export default function ElectionResults() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine active filter from URL
  const activeParam = GEO_PARAMS.find((p) => searchParams.has(p)) ?? null;
  const activeValue = activeParam ? searchParams.get(activeParam) : null;

  const fetchResults = useCallback(
    (param: string | null, value: string | null) => {
      setLoading(true);
      setError(null);
      const url =
        param && value
          ? `/api/elections/${id}/results?${param}=${value}`
          : `/api/elections/${id}/results`;
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(setData)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    },
    [id]
  );

  // Initial fetch based on URL params
  useEffect(() => {
    fetchResults(activeParam, activeValue);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = useCallback(
    (param: string | null, value: string | null) => {
      if (param && value) {
        setSearchParams({ [param]: value });
      } else {
        setSearchParams({});
      }
      fetchResults(param, value);
    },
    [fetchResults, setSearchParams]
  );

  return (
    <div>
      <p>
        <Link to="/">Back to elections</Link>
      </p>
      {data && (
        <>
          <h1>{data.election.name}</h1>
          <p>
            Date: {data.election.date} | Type: {data.election.type}
            {" | "}
            <Link to={`/elections/${data.election.id}/anomalies`}>Anomalies</Link>
            {" | "}
            <Link to={`/map/${data.election.id}`}>Map</Link>
          </p>
        </>
      )}
      <LocationFilter
        onFilterChange={handleFilterChange}
        initialParam={activeParam}
        initialValue={activeValue}
      />
      {loading && <p>Loading results...</p>}
      {error && <p>Error: {error}</p>}
      {!loading && !error && data && (
        <table>
          <thead>
            <tr>
              <th>Party</th>
              <th>Votes</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((r) => (
              <tr key={r.party_id}>
                <td><Link to={`/parties/${r.party_id}`}>{r.party_name}</Link></td>
                <td>{r.total_votes.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
