import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface CoalitionRef {
  id: number;
  canonical_name: string;
  color: string | null;
}

interface ElectionResult {
  election_id: number;
  election_name: string;
  election_date: string;
  election_type: string;
  ballot_number: number;
  name_on_ballot: string | null;
  votes: number;
  percentage: number;
}

interface PartyDetail {
  id: number;
  canonical_name: string;
  short_name: string | null;
  party_type: string;
  color: string | null;
  wiki_url: string | null;
  coalitions: CoalitionRef[];
  members: CoalitionRef[];
  elections: ElectionResult[];
}

export default function PartyProfile() {
  const { id } = useParams();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/parties/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setParty)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p>Loading party...</p>;
  if (error) return <p>Error: {error}</p>;
  if (!party) return <p>Party not found.</p>;

  const partyColor = party.color || "#888";

  // Chart data: elections sorted by date ascending for the trend line
  const sortedElections = [...party.elections].sort(
    (a, b) => a.election_date.localeCompare(b.election_date)
  );

  const showChart = sortedElections.length >= 2;

  const chartData = {
    labels: sortedElections.map((e) => e.election_date),
    datasets: [
      {
        label: "Vote share (%)",
        data: sortedElections.map((e) => e.percentage),
        borderColor: partyColor,
        backgroundColor: partyColor + "33",
        fill: true,
        tension: 0.3,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: "Vote Share Over Time (%)" },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: "Percentage (%)" },
      },
    },
  };

  return (
    <div>
      <p>
        <Link to="/parties">Back to parties</Link>
        {" | "}
        <Link to="/">Elections</Link>
      </p>

      <h1>
        {party.canonical_name}
        {party.color && (
          <span
            style={{
              display: "inline-block",
              width: 20,
              height: 20,
              backgroundColor: party.color,
              border: "1px solid #ccc",
              verticalAlign: "middle",
              marginLeft: "0.5rem",
            }}
          />
        )}
      </h1>

      <p>
        {party.short_name && <>Short name: {party.short_name} | </>}
        Type: <strong>{party.party_type}</strong>
        {party.wiki_url && (
          <>
            {" | "}
            <a href={party.wiki_url} target="_blank" rel="noopener noreferrer">
              Wikipedia
            </a>
          </>
        )}
      </p>

      {party.coalitions.length > 0 && (
        <section>
          <h2>Member of coalitions</h2>
          <ul>
            {party.coalitions.map((c) => (
              <li key={c.id}>
                <Link to={`/parties/${c.id}`}>{c.canonical_name}</Link>
                {c.color && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      backgroundColor: c.color,
                      border: "1px solid #ccc",
                      marginLeft: "0.5rem",
                      verticalAlign: "middle",
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {party.members.length > 0 && (
        <section>
          <h2>Coalition members</h2>
          <ul>
            {party.members.map((m) => (
              <li key={m.id}>
                <Link to={`/parties/${m.id}`}>{m.canonical_name}</Link>
                {m.color && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      backgroundColor: m.color,
                      border: "1px solid #ccc",
                      marginLeft: "0.5rem",
                      verticalAlign: "middle",
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {showChart && (
        <div style={{ maxWidth: "700px", margin: "1rem 0" }}>
          <Line data={chartData} options={chartOptions} />
        </div>
      )}

      <h2>Election results</h2>
      {party.elections.length === 0 ? (
        <p>No election results found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Election</th>
              <th>Date</th>
              <th>#</th>
              <th>Name on ballot</th>
              <th>Votes</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {party.elections.map((e) => (
              <tr key={e.election_id}>
                <td>
                  <Link to={`/elections/${e.election_id}`}>{e.election_name}</Link>
                </td>
                <td>{e.election_date}</td>
                <td>{e.ballot_number}</td>
                <td>{e.name_on_ballot ?? "—"}</td>
                <td>{e.votes.toLocaleString()}</td>
                <td>{e.percentage}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
