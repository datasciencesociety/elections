import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";

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

export default function ElectionResults() {
  const { id } = useParams();
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/elections/${id}/results`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p>Loading results...</p>;
  if (error) return <p>Error: {error}</p>;
  if (!data) return <p>No data</p>;

  return (
    <div>
      <p>
        <Link to="/">Back to elections</Link>
      </p>
      <h1>{data.election.name}</h1>
      <p>
        Date: {data.election.date} | Type: {data.election.type}
      </p>
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
              <td>{r.party_name}</td>
              <td>{r.total_votes.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
