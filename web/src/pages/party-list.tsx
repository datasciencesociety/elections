import { useEffect, useState } from "react";
import { Link } from "react-router";

interface Party {
  id: number;
  canonical_name: string;
  short_name: string | null;
  party_type: string;
  color: string | null;
  election_count: number;
  total_votes: number;
}

export default function PartyList() {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    fetch("/api/parties")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setParties)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = parties.filter((p) => {
    if (typeFilter && p.party_type !== typeFilter) return false;
    if (nameFilter) {
      const q = nameFilter.toLowerCase();
      const matchName = p.canonical_name.toLowerCase().includes(q);
      const matchShort = p.short_name?.toLowerCase().includes(q);
      if (!matchName && !matchShort) return false;
    }
    return true;
  });

  if (loading) return <p>Loading parties...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div>
      <p>
        <Link to="/">Back to elections</Link>
      </p>
      <h1>Parties</h1>
      <div style={{ marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="Filter by name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          style={{ marginRight: "1rem" }}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="party">Party</option>
          <option value="coalition">Coalition</option>
          <option value="initiative_committee">Initiative Committee</option>
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Short Name</th>
            <th>Type</th>
            <th>Color</th>
            <th>Elections</th>
            <th>Total Votes</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/parties/${p.id}`}>{p.canonical_name}</Link>
              </td>
              <td>{p.short_name ?? "—"}</td>
              <td>{p.party_type}</td>
              <td>
                {p.color ? (
                  <span
                    style={{
                      display: "inline-block",
                      width: 16,
                      height: 16,
                      backgroundColor: p.color,
                      border: "1px solid #ccc",
                      verticalAlign: "middle",
                    }}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>{p.election_count}</td>
              <td>{p.total_votes.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
