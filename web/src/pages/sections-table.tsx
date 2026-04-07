import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router";
import Sidebar from "@/components/sidebar.js";
import { RiskSidebarContent, type RiskSection } from "./risk-map.js";

// Truncate to 2 decimal places without rounding (3.999 → "3.99")
function pct2(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

interface GeoEntity {
  id: number;
  name: string;
}

type Methodology = "combined" | "benford" | "peer" | "acf";
type SortColumn = "risk_score" | "benford_risk" | "peer_risk" | "acf_risk" | "turnout_rate" | "section_code" | "settlement_name";

function RiskBadge({ value }: { value: number }) {
  const bg =
    value >= 0.6 ? "bg-red-100 text-red-800" :
    value >= 0.3 ? "bg-orange-100 text-orange-800" :
    "bg-green-100 text-green-800";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums ${bg}`}>
      {value.toFixed(2)}
    </span>
  );
}

function SortHeader({
  label,
  column,
  currentSort,
  currentOrder,
  onSort,
}: {
  label: string;
  column: SortColumn;
  currentSort: SortColumn;
  currentOrder: "asc" | "desc";
  onSort: (col: SortColumn) => void;
}) {
  const active = currentSort === column;
  return (
    <th
      className="cursor-pointer select-none whitespace-nowrap px-2 py-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onSort(column)}
    >
      {label}
      {active && <span className="ml-0.5">{currentOrder === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

const PAGE_SIZE = 100;

export default function SectionsTable() {
  const { electionId } = useParams<{ electionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = (searchParams.get("sort") ?? "risk_score") as SortColumn;
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";
  const methodology = (searchParams.get("m") ?? "combined") as Methodology;
  const minRisk = parseFloat(searchParams.get("risk") ?? "0");
  const district = searchParams.get("district") ?? "";
  const municipality = searchParams.get("municipality") ?? "";
  const sectionFilter = searchParams.get("q") ?? "";
  const page = parseInt(searchParams.get("page") ?? "0", 10);
  const selectedCode = searchParams.get("section") ?? "";

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSort = (col: SortColumn) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (sort === col) {
        next.set("order", order === "desc" ? "asc" : "desc");
      } else {
        next.set("sort", col);
        next.set("order", "desc");
      }
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const [sections, setSections] = useState<RiskSection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [districts, setDistricts] = useState<GeoEntity[]>([]);
  const [municipalities, setMunicipalities] = useState<GeoEntity[]>([]);

  useEffect(() => {
    fetch("/api/geography/districts").then((r) => r.json()).then(setDistricts);
  }, []);

  useEffect(() => {
    if (!district) { setMunicipalities([]); return; }
    fetch(`/api/geography/municipalities?district=${district}`).then((r) => r.json()).then(setMunicipalities);
  }, [district]);

  useEffect(() => {
    if (!electionId) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("min_risk", String(minRisk));
    params.set("sort", sort);
    params.set("order", order);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (methodology !== "combined") params.set("methodology", methodology);
    if (municipality) params.set("municipality", municipality);
    else if (district) params.set("district", district);
    if (sectionFilter) params.set("section", sectionFilter);

    fetch(`/api/elections/${electionId}/anomalies?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setSections(data.sections ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [electionId, sort, order, methodology, minRisk, district, municipality, sectionFilter, page]);

  const selectedSection = selectedCode ? sections.find((s) => s.section_code === selectedCode) ?? null : null;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const methodologies: { key: Methodology; label: string }[] = [
    { key: "combined", label: "Комбиниран" },
    { key: "benford", label: "Benford" },
    { key: "peer", label: "Peer" },
    { key: "acf", label: "ACF" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-background px-4 py-2.5">
        {/* Risk threshold */}
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">
            Мин. риск: <span className="font-bold text-foreground">{minRisk.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minRisk}
            onChange={(e) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                const v = parseFloat(e.target.value);
                if (v === 0) next.delete("risk"); else next.set("risk", String(v));
                next.delete("page");
                return next;
              }, { replace: true });
            }}
            className="w-32 accent-red-500"
          />
        </div>

        {/* Methodology */}
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Методология</div>
          <div className="flex gap-0.5">
            {methodologies.map((m) => (
              <button
                key={m.key}
                onClick={() => setParam("m", m.key === "combined" ? "" : m.key)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  methodology === m.key
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* District */}
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Област</div>
          <select
            value={district}
            onChange={(e) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("district", e.target.value); else next.delete("district");
                next.delete("municipality");
                next.delete("page");
                return next;
              }, { replace: true });
            }}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
          >
            <option value="">Всички</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {/* Municipality */}
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Община</div>
          <select
            value={municipality}
            onChange={(e) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("municipality", e.target.value); else next.delete("municipality");
                next.delete("page");
                return next;
              }, { replace: true });
            }}
            disabled={!district}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs disabled:opacity-50"
          >
            <option value="">Всички</option>
            {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        {/* Section search */}
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Секция №</div>
          <input
            type="text"
            value={sectionFilter}
            onChange={(e) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("q", e.target.value); else next.delete("q");
                next.delete("page");
                return next;
              }, { replace: true });
            }}
            placeholder="напр. 234600001"
            className="h-7 w-36 rounded-md border border-border bg-background px-2 text-xs placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Count */}
        <div className="ml-auto text-xs text-muted-foreground">
          {loading ? "..." : <><b>{total.toLocaleString()}</b> секции</>}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-background">
            <tr>
              <SortHeader label="Секция" column="section_code" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Населено място" column="settlement_name" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Активност" column="turnout_rate" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Комб. риск" column="risk_score" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Benford" column="benford_risk" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Peer" column="peer_risk" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="ACF" column="acf_risk" currentSort={sort} currentOrder={order} onSort={setSort} />
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Флагове</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr
                key={s.section_code}
                onClick={() => setParam("section", selectedCode === s.section_code ? "" : s.section_code)}
                className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-secondary/50 ${
                  selectedCode === s.section_code ? "bg-secondary" : ""
                }`}
              >
                <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{s.section_code}</td>
                <td className="max-w-[200px] truncate px-2 py-1.5" title={s.settlement_name}>{s.settlement_name}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{pct2(s.turnout_rate * 100)}%</td>
                <td className="whitespace-nowrap px-2 py-1.5"><RiskBadge value={s.risk_score} /></td>
                <td className="whitespace-nowrap px-2 py-1.5"><RiskBadge value={s.benford_risk} /></td>
                <td className="whitespace-nowrap px-2 py-1.5"><RiskBadge value={s.peer_risk} /></td>
                <td className="whitespace-nowrap px-2 py-1.5"><RiskBadge value={s.acf_risk} /></td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {s.arithmetic_error ? <span className="mr-1 rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-700">АГ</span> : null}
                  {s.vote_sum_mismatch ? <span className="mr-1 rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-700">НС</span> : null}
                  {s.acf_multicomponent >= 1 ? <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-700">ACF×3</span> : null}
                </td>
              </tr>
            ))}
            {!loading && sections.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  Няма секции, отговарящи на филтрите
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border bg-background px-4 py-2">
          <button
            disabled={page === 0}
            onClick={() => setParam("page", page > 1 ? String(page - 1) : "")}
            className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-30"
          >
            ← Предишна
          </button>
          <span className="text-xs text-muted-foreground">
            Страница {page + 1} от {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setParam("page", String(page + 1))}
            className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-30"
          >
            Следваща →
          </button>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar
        open={!!selectedSection}
        onClose={() => setParam("section", "")}
        title={selectedSection?.section_code}
      >
        {selectedSection && electionId && (
          <RiskSidebarContent section={selectedSection} electionId={electionId} />
        )}
      </Sidebar>
    </div>
  );
}
