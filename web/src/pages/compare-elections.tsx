import { Fragment, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router";
import LocationFilter from "../components/location-filter.js";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

interface PartyElectionData {
  votes: number;
  percentage: number;
}

interface ComparePartyResult {
  party_id: number;
  party_name: string;
  elections: Record<string, PartyElectionData>;
}

interface CompareResponse {
  elections: Election[];
  results: ComparePartyResult[];
}

const GEO_PARAMS = ["rik", "district", "municipality", "kmetstvo", "local_region"] as const;

const CHART_COLORS = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

export default function CompareElections() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [allElections, setAllElections] = useState<Election[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const param = searchParams.get("elections");
    if (!param) return new Set();
    return new Set(param.split(",").map(Number).filter((n) => !isNaN(n)));
  });
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoFilter, setGeoFilter] = useState<{ param: string | null; value: string | null }>(() => {
    const p = GEO_PARAMS.find((p) => searchParams.has(p)) ?? null;
    return { param: p, value: p ? searchParams.get(p) : null };
  });

  useEffect(() => {
    fetch("/api/elections")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setAllElections)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (selectedIds.size > 0) {
      params.elections = Array.from(selectedIds).join(",");
    }
    if (geoFilter.param && geoFilter.value) {
      params[geoFilter.param] = geoFilter.value;
    }
    setSearchParams(params, { replace: true });
  }, [selectedIds, geoFilter, setSearchParams]);

  useEffect(() => {
    if (selectedIds.size < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const ids = Array.from(selectedIds).join(",");
    let url = `/api/elections/compare?elections=${ids}`;
    if (geoFilter.param && geoFilter.value) {
      url += `&${geoFilter.param}=${geoFilter.value}`;
    }
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedIds, geoFilter]);

  const handleToggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleFilterChange = useCallback((param: string | null, value: string | null) => {
    setGeoFilter({ param, value });
  }, []);

  const activeParam = geoFilter.param;
  const activeValue = geoFilter.value;

  const chartData = data ? (() => {
    const top15 = data.results.slice(0, 15);
    const labels = top15.map((r) => r.party_name);
    const datasets = data.elections.map((el, idx) => ({
      label: `${el.name} (${el.date})`,
      data: top15.map((r) => r.elections[String(el.id)]?.percentage ?? 0),
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
    }));
    return { labels, datasets };
  })() : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          boxWidth: 12,
          font: { size: 11 },
          color: "rgb(156, 163, 175)",
        },
      },
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
        ticks: { font: { size: 10 }, color: "rgb(156, 163, 175)", maxRotation: 45 },
        grid: { display: false },
      },
    },
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-4 border-b border-border bg-background px-4 py-2.5">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Избори за сравнение (2-10)</div>
          <div className="flex flex-wrap gap-1.5">
            {allElections.map((e) => {
              const checked = selectedIds.has(e.id);
              const disabled = !checked && selectedIds.size >= 10;
              return (
                <label
                  key={e.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    checked
                      ? "border-foreground/30 bg-foreground/10 text-foreground"
                      : disabled
                      ? "cursor-not-allowed border-border text-muted-foreground/50"
                      : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggle(e.id)}
                    disabled={disabled}
                    className="accent-foreground"
                  />
                  {e.name} ({e.date})
                </label>
              );
            })}
          </div>
        </div>

        <LocationFilter
          onFilterChange={handleFilterChange}
          initialParam={activeParam}
          initialValue={activeValue}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {selectedIds.size < 2 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Изберете поне 2 избора за сравнение.
          </div>
        )}

        {loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        )}

        {error && (
          <div className="px-4 py-8 text-center text-sm text-red-500">Грешка: {error}</div>
        )}

        {!loading && !error && data && chartData && (
          <div className="space-y-4 p-4">
            {/* Chart */}
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Дял на гласовете (%)</div>
              <div className="h-[350px]">
                <Bar data={chartData} options={chartOptions} />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-secondary/50">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Партия</th>
                    {data.elections.map((el) => (
                      <th
                        key={el.id}
                        colSpan={2}
                        className="whitespace-nowrap px-3 py-2 text-center text-[11px] font-medium text-muted-foreground"
                      >
                        {el.name} ({el.date})
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-border/50">
                    <th />
                    {data.elections.map((el) => (
                      <Fragment key={el.id}>
                        <th className="px-2 py-1 text-right text-[10px] font-normal text-muted-foreground/70">Гласове</th>
                        <th className="px-2 py-1 text-right text-[10px] font-normal text-muted-foreground/70">%</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r, idx) => (
                    <tr
                      key={r.party_id}
                      className={`border-b border-border/50 transition-colors hover:bg-secondary/50 ${
                        idx % 2 === 0 ? "" : "bg-secondary/20"
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium">{r.party_name}</td>
                      {data.elections.map((el) => {
                        const d = r.elections[String(el.id)];
                        return (
                          <Fragment key={el.id}>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">
                              {(d?.votes ?? 0).toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold tabular-nums">
                              {d?.percentage ?? 0}%
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

