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

const TYPE_LABELS: Record<string, string> = {
  party: "Партия",
  coalition: "Коалиция",
  initiative_committee: "Инициативен комитет",
};

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

  if (loading) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">Зареждане...</div>;
  }
  if (error) {
    return <div className="px-4 py-8 text-center text-sm text-red-500">Грешка: {error}</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-4 border-b border-border bg-background px-4 py-2.5">
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Търсене</div>
          <input
            type="text"
            placeholder="Име на партия..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs placeholder:text-muted-foreground/50"
          />
        </div>
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Тип</div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
          >
            <option value="">Всички</option>
            <option value="party">Партия</option>
            <option value="coalition">Коалиция</option>
            <option value="initiative_committee">Инициативен комитет</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          <b>{filtered.length}</b> от {parties.length}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-background">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Име</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Абревиатура</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Тип</th>
              <th className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">Цвят</th>
              <th className="px-2 py-2 text-right text-[11px] font-medium text-muted-foreground">Избори</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Общо гласове</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => (
              <tr
                key={p.id}
                className={`border-b border-border/50 transition-colors hover:bg-secondary/50 ${
                  idx % 2 === 0 ? "" : "bg-secondary/20"
                }`}
              >
                <td className="px-3 py-1.5">
                  <Link to={`/parties/${p.id}`} className="text-blue-500 hover:underline">
                    {p.canonical_name}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{p.short_name ?? "—"}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{TYPE_LABELS[p.party_type] ?? p.party_type}</td>
                <td className="px-2 py-1.5 text-center">
                  {p.color ? (
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-sm border border-border"
                      style={{ backgroundColor: p.color }}
                    />
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{p.election_count}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.total_votes.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
