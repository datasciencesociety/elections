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

const TYPE_LABELS: Record<string, string> = {
  party: "Партия",
  coalition: "Коалиция",
  initiative_committee: "Инициативен комитет",
};

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

  if (loading) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">Зареждане...</div>;
  }
  if (error) {
    return <div className="px-4 py-8 text-center text-sm text-red-500">Грешка: {error}</div>;
  }
  if (!party) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">Партията не е намерена.</div>;
  }

  const partyColor = party.color || "#888";

  const sortedElections = [...party.elections].sort(
    (a, b) => a.election_date.localeCompare(b.election_date)
  );

  const showChart = sortedElections.length >= 2;

  const chartData = {
    labels: sortedElections.map((e) => e.election_date),
    datasets: [
      {
        label: "Дял (%)",
        data: sortedElections.map((e) => e.percentage),
        borderColor: partyColor,
        backgroundColor: partyColor + "33",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: "%", font: { size: 11 }, color: "rgb(156, 163, 175)" },
        ticks: { font: { size: 10 }, color: "rgb(156, 163, 175)" },
        grid: { color: "rgba(156, 163, 175, 0.1)" },
      },
      x: {
        ticks: { font: { size: 10 }, color: "rgb(156, 163, 175)" },
        grid: { display: false },
      },
    },
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        {/* Breadcrumb */}
        <div className="text-xs text-muted-foreground">
          <Link to="/parties" className="hover:text-foreground hover:underline">Партии</Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground">{party.short_name || party.canonical_name}</span>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          {party.color && (
            <span
              className="mt-1 inline-block h-5 w-5 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: party.color }}
            />
          )}
          <div>
            <h1 className="text-lg font-bold">{party.canonical_name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {party.short_name && <span>{party.short_name}</span>}
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                {TYPE_LABELS[party.party_type] ?? party.party_type}
              </span>
              {party.wiki_url && (
                <a href={party.wiki_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                  Wikipedia
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Coalitions / Members */}
        {party.coalitions.length > 0 && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-[11px] font-medium text-muted-foreground">Член на коалиции</div>
            <div className="flex flex-wrap gap-2">
              {party.coalitions.map((c) => (
                <Link
                  key={c.id}
                  to={`/parties/${c.id}`}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-secondary"
                >
                  {c.color && (
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                  )}
                  {c.canonical_name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {party.members.length > 0 && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-[11px] font-medium text-muted-foreground">Членове на коалицията</div>
            <div className="flex flex-wrap gap-2">
              {party.members.map((m) => (
                <Link
                  key={m.id}
                  to={`/parties/${m.id}`}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-secondary"
                >
                  {m.color && (
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: m.color }} />
                  )}
                  {m.canonical_name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Chart */}
        {showChart && (
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-[11px] font-medium text-muted-foreground">Дял на гласовете през годините</div>
            <div className="h-[250px]">
              <Line data={chartData} options={chartOptions} />
            </div>
          </div>
        )}

        {/* Results table */}
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-secondary/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
            Резултати по избори
          </div>
          {party.elections.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Няма данни.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-secondary/20">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Избори</th>
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Дата</th>
                  <th className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">№</th>
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Име в бюлетината</th>
                  <th className="px-2 py-2 text-right text-[11px] font-medium text-muted-foreground">Гласове</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">%</th>
                </tr>
              </thead>
              <tbody>
                {party.elections.map((e, idx) => (
                  <tr
                    key={e.election_id}
                    className={`border-b border-border/50 transition-colors hover:bg-secondary/50 ${
                      idx % 2 === 0 ? "" : "bg-secondary/20"
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <Link to={`/${e.election_id}/results`} className="text-blue-500 hover:underline">
                        {e.election_name}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{e.election_date}</td>
                    <td className="px-2 py-1.5 text-center font-mono tabular-nums">{e.ballot_number}</td>
                    <td className="max-w-[250px] truncate px-2 py-1.5 text-muted-foreground" title={e.name_on_ballot ?? undefined}>
                      {e.name_on_ballot ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{e.votes.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{e.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
