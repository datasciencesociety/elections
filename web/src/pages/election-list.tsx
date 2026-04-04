import { useEffect, useState } from "react";
import { Link } from "react-router";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

export default function ElectionList() {
  const [elections, setElections] = useState<Election[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/elections")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setElections)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading elections...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div>
      <h1>Elections</h1>
      <ul>
        {elections.map((e) => (
          <li key={e.id}>
            <Link to={`/elections/${e.id}`}>
              {e.name} ({e.date})
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
