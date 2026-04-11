import { useCallback } from "react";
import { useParams, useSearchParams } from "react-router";
import Sidebar from "@/components/sidebar.js";
import { SectionView } from "@/components/section/index.js";
import type { AnomalyMethodology, AnomalySection } from "@/lib/api/types.js";
import { useAnomalies } from "@/lib/hooks/use-anomalies.js";
import { useDistricts, useMunicipalities } from "@/lib/hooks/use-geography.js";
import { useSectionViolations } from "@/lib/hooks/use-sections.js";
import { ScoreBadge } from "@/components/score/index.js";

// Truncate to 2 decimal places without rounding (3.999 → "3.99")
function pct2(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

const SECTION_TYPE_LABELS: Record<string, string> = {
  mobile: "Подвижна",
  hospital: "Болница",
  abroad: "Чужбина",
  prison: "Затвор",
};

type RiskSection = AnomalySection;
// This page uses the four "score" methodologies — protocol filter lives in
// the violation filter below, not in the methodology toggle.
type Methodology = Exclude<AnomalyMethodology, "protocol">;
type ViolationFilter = "all" | "with_violations";
type SortColumn = "risk_score" | "benford_risk" | "peer_risk" | "acf_risk" | "turnout_rate" | "section_code" | "settlement_name" | "protocol_violation_count" | "registered_voters" | "actual_voters";

function SortHeader({
  label,
  column,
  currentSort,
  currentOrder,
  onSort,
  className,
}: {
  label: string;
  column: SortColumn;
  currentSort: SortColumn;
  currentOrder: "asc" | "desc";
  onSort: (col: SortColumn) => void;
  className?: string;
}) {
  const active = currentSort === column;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground ${className ?? ""}`}
      onClick={() => onSort(column)}
    >
      {label}
      {active && <span className="ml-0.5">{currentOrder === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

function ViolationDetail({ electionId, sectionCode }: { electionId: string; sectionCode: string }) {
  const { data, isLoading } = useSectionViolations(electionId, sectionCode);
  if (isLoading) return <span className="text-[10px] text-muted-foreground">...</span>;
  const violations = data?.violations ?? [];
  if (violations.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {violations.map((v, i) => (
        <div
          key={i}
          className={`rounded px-2 py-1 text-[10px] ${
            v.severity === "error" ? "bg-red-50 text-red-800" : "bg-yellow-50 text-yellow-800"
          }`}
        >
          <span className="font-mono font-semibold">{v.rule_id}</span>{" "}
          {v.description}
          <span className="ml-2 text-muted-foreground">
            ({v.expected_value} → {v.actual_value})
          </span>
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 100;

export default function SectionsTable() {
  const { electionId } = useParams<{ electionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = (searchParams.get("sort") ?? "risk_score") as SortColumn;
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";
  const methodology = (searchParams.get("m") ?? "combined") as Methodology;
  const violationFilter = (searchParams.get("v") ?? "all") as ViolationFilter;
  const includeSpecial = searchParams.get("special") === "1";
  const minRisk = parseFloat(searchParams.get("risk") ?? "0");
  const district = searchParams.get("district") ?? "";
  const municipality = searchParams.get("municipality") ?? "";
  const sectionFilter = searchParams.get("q") ?? "";
  const page = parseInt(searchParams.get("page") ?? "0", 10);
  const selectedCode = searchParams.get("section") ?? "";
  const expandedCode = searchParams.get("expand") ?? "";

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

  const { data: districts = [] } = useDistricts();
  const { data: municipalities = [] } = useMunicipalities(district || undefined);

  const { data: anomaliesData, isLoading: loading } = useAnomalies({
    electionId: electionId!,
    minRisk,
    methodology,
    sort,
    order,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    minViolations: violationFilter === "with_violations" ? 1 : undefined,
    excludeSpecial: violationFilter === "with_violations" && !includeSpecial,
    district: district || undefined,
    municipality: municipality || undefined,
    section: sectionFilter || undefined,
  });
  const sections: RiskSection[] = anomaliesData?.sections ?? [];
  const total = anomaliesData?.total ?? 0;

  const selectedSection = selectedCode ? sections.find((s) => s.section_code === selectedCode) ?? null : null;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const methodologies: { key: Methodology; label: string }[] = [
    { key: "combined", label: "Комбиниран" },
    { key: "benford", label: "Benford" },
    { key: "peer", label: "Peer" },
    { key: "acf", label: "ACF" },
  ];

  const violationFilters: { key: ViolationFilter; label: string }[] = [
    { key: "all", label: "Всички" },
    { key: "with_violations", label: "С нарушения" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-2 border-b border-border bg-background px-2 py-2 md:gap-3 md:px-4 md:py-2.5">
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

        {/* Risk Methodology */}
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

        {/* Protocol violations filter */}
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Протокол</div>
          <div className="flex items-center gap-0.5">
            {violationFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (f.key === "all") next.delete("v");
                    else next.set("v", f.key);
                    next.delete("page");
                    return next;
                  }, { replace: true });
                }}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  violationFilter === f.key
                    ? "bg-red-600 text-white"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
            {violationFilter === "with_violations" && (
              <label className="ml-1.5 flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeSpecial}
                  onChange={(e) => setParam("special", e.target.checked ? "1" : "")}
                  className="size-3 accent-red-500"
                />
                +болници/затвори
              </label>
            )}
          </div>
        </div>

        {/* District */}
        <div className="w-full sm:w-auto">
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
        <div className="w-full sm:w-auto">
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
        <table className="min-w-[900px] text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-background">
            <tr>
              <SortHeader label="Секция" column="section_code" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Населено място" column="settlement_name" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Избиратели" column="registered_voters" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Гласували" column="actual_voters" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Активност" column="turnout_rate" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Комб. риск" column="risk_score" currentSort={sort} currentOrder={order} onSort={setSort} />
              <SortHeader label="Benford" column="benford_risk" currentSort={sort} currentOrder={order} onSort={setSort} className="hidden md:table-cell" />
              <SortHeader label="Peer" column="peer_risk" currentSort={sort} currentOrder={order} onSort={setSort} className="hidden md:table-cell" />
              <SortHeader label="ACF" column="acf_risk" currentSort={sort} currentOrder={order} onSort={setSort} className="hidden md:table-cell" />
              <SortHeader label="Нарушения" column="protocol_violation_count" currentSort={sort} currentOrder={order} onSort={setSort} />
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Флагове</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <>
                <tr
                  key={s.section_code}
                  onClick={() => setParam("section", selectedCode === s.section_code ? "" : s.section_code)}
                  className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-secondary/50 ${
                    selectedCode === s.section_code ? "bg-secondary" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{s.section_code}</td>
                  <td className="max-w-[200px] px-2 py-1.5" title={s.settlement_name}>
                    <span className="flex items-center gap-1">
                      <span className="truncate">{s.settlement_name}</span>
                      {SECTION_TYPE_LABELS[s.section_type] && (
                        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium">{SECTION_TYPE_LABELS[s.section_type]}</span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{(s.registered_voters ?? 0).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{(s.actual_voters ?? 0).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{pct2(s.turnout_rate * 100)}%</td>
                  <td className="whitespace-nowrap px-2 py-1.5"><ScoreBadge value={s.risk_score} /></td>
                  <td className="hidden whitespace-nowrap px-2 py-1.5 md:table-cell"><ScoreBadge value={s.benford_risk} /></td>
                  <td className="hidden whitespace-nowrap px-2 py-1.5 md:table-cell"><ScoreBadge value={s.peer_risk} /></td>
                  <td className="hidden whitespace-nowrap px-2 py-1.5 md:table-cell"><ScoreBadge value={s.acf_risk} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {s.protocol_violation_count > 0 ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setParam("expand", expandedCode === s.section_code ? "" : s.section_code);
                        }}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums ${
                          s.protocol_violation_count >= 3 ? "bg-red-100 text-red-800" : "bg-orange-100 text-orange-800"
                        }`}
                      >
                        {s.protocol_violation_count} {expandedCode === s.section_code ? "▲" : "▼"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/40">0</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {s.arithmetic_error ? <span className="mr-1 rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-700">АГ</span> : null}
                    {s.vote_sum_mismatch ? <span className="mr-1 rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-700">НС</span> : null}
                    {s.acf_multicomponent >= 1 ? <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-700">ACF×3</span> : null}
                  </td>
                </tr>
                {expandedCode === s.section_code && s.protocol_violation_count > 0 && electionId && (
                  <tr key={`${s.section_code}-expand`} className="border-b border-border/50">
                    <td colSpan={11} className="bg-muted/30 px-2 py-2">
                      <ViolationDetail electionId={electionId} sectionCode={s.section_code} />
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!loading && sections.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
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
          <SectionView
            electionId={electionId}
            sectionCode={selectedSection.section_code}
            initialAnomaly={selectedSection}
          />
        )}
      </Sidebar>
    </div>
  );
}
