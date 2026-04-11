import { useCallback } from "react";
import { useSearchParams } from "react-router";
import SectionPreview from "@/components/section-preview.js";
import type { PersistenceSection as PersistentSection } from "@/lib/api/types.js";
import { usePersistence } from "@/lib/hooks/use-persistence.js";
import {
  ScoreBadge,
  SCORE_SOLID_CLASS,
  scoreLevel,
} from "@/components/score/index.js";

type SortColumn =
  | "persistence_score"
  | "elections_flagged"
  | "consistency"
  | "avg_risk"
  | "max_risk"
  | "total_violations"
  | "section_code"
  | "settlement_name"
  | "avg_registered"
  | "avg_voted"
  | "avg_turnout";

function FlagDots({ section, electionsCount }: { section: PersistentSection; electionsCount: number }) {
  const items = [
    { label: "B", count: section.benford_flags, color: "bg-blue-500" },
    { label: "P", count: section.peer_flags, color: "bg-amber-500" },
    { label: "A", count: section.acf_flags, color: "bg-purple-500" },
    { label: "Пр", count: section.protocol_flags, color: "bg-red-500" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {items.map((item) =>
        item.count > 0 ? (
          <span
            key={item.label}
            className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-white ${item.color}`}
            title={`${item.label}: ${item.count}/${electionsCount}`}
          >
            {item.label}:{item.count}
          </span>
        ) : null,
      )}
    </div>
  );
}

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

export default function Persistence() {
  const [searchParams, setSearchParams] = useSearchParams();
  const LIMIT = 50;

  // Read state from URL
  const sort = (searchParams.get("sort") ?? "persistence_score") as SortColumn;
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const minElections = parseInt(searchParams.get("min") ?? "5", 10);
  const excludeSpecial = searchParams.get("special") !== "1";
  const expandedSection = searchParams.get("preview") ?? null;
  const sectionSearch = searchParams.get("q") ?? "";

  const setParam = useCallback((updates: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const { data, isLoading: loading, isError } = usePersistence({
    sort,
    order,
    limit: LIMIT,
    offset,
    minElections,
    excludeSpecial,
    section: sectionSearch || undefined,
  });
  const error = isError ? "Грешка при зареждане" : null;

  const handleSort = (col: SortColumn) => {
    if (sort === col) {
      setParam({ order: order === "desc" ? "asc" : "desc", offset: null });
    } else {
      setParam({ sort: col, order: "desc", offset: null });
    }
  };

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2 border-b border-border bg-background px-2 py-2 md:gap-3 md:px-4 md:py-2.5">
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Мин. избори</div>
          <select
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
            value={minElections}
            onChange={(e) => setParam({ min: e.target.value === "5" ? null : e.target.value, offset: null })}
          >
            {[3, 5, 8, 10, 12].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </div>

        <div className="flex items-end pb-1">
          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={excludeSpecial}
              onChange={(e) => setParam({ special: e.target.checked ? null : "1", offset: null })}
              className="size-3 accent-red-500"
            />
            Без специални
          </label>
        </div>

        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Секция</div>
          <input
            type="text"
            placeholder="Търси..."
            value={sectionSearch}
            onChange={(e) => setParam({ q: e.target.value || null, offset: null })}
            className="h-7 w-28 rounded-md border border-border bg-background px-2 text-xs placeholder:text-muted-foreground"
          />
        </div>

        {data && (
          <span className="ml-auto pb-1 text-[11px] text-muted-foreground">
            {data.total.toLocaleString()} секции · {data.elections_count} избори
          </span>
        )}
      </div>

      {/* Table + Sidebar */}
      <div className="relative flex-1 overflow-hidden">
      <div className="h-full overflow-auto overflow-x-auto">
        {error && <div className="p-4 text-sm text-red-600">{error}</div>}
        {loading && !data && <div className="p-4 text-sm text-muted-foreground">Зареждане...</div>}

        {data && (
          <table className="min-w-[900px] text-xs">
            <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0] shadow-border">
              <tr>
                <SortHeader label="Секция" column="section_code" currentSort={sort} currentOrder={order} onSort={handleSort} />
                <SortHeader label="Населено място" column="settlement_name" currentSort={sort} currentOrder={order} onSort={handleSort} />
                <SortHeader label="Индекс" column="persistence_score" currentSort={sort} currentOrder={order} onSort={handleSort} />
                <SortHeader label="Флагнати" column="elections_flagged" currentSort={sort} currentOrder={order} onSort={handleSort} />
                <SortHeader label="Консист." column="consistency" currentSort={sort} currentOrder={order} onSort={handleSort} className="hidden md:table-cell" />
                <SortHeader label="Ср. риск" column="avg_risk" currentSort={sort} currentOrder={order} onSort={handleSort} className="hidden md:table-cell" />
                <SortHeader label="Макс." column="max_risk" currentSort={sort} currentOrder={order} onSort={handleSort} className="hidden lg:table-cell" />
                <SortHeader label="Ср. активност" column="avg_turnout" currentSort={sort} currentOrder={order} onSort={handleSort} className="hidden md:table-cell" />
                <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Методологии</th>
              </tr>
            </thead>
            <tbody>
              {data.sections.map((s) => (
                <tr
                  key={s.section_code}
                  className={`cursor-pointer border-t border-border/50 transition-colors hover:bg-muted/50 ${expandedSection === s.section_code ? "bg-muted/50" : ""}`}
                  onClick={() => setParam({ preview: expandedSection === s.section_code ? null : s.section_code })}
                >
                  <td className="px-2 py-1.5 font-mono text-[11px] tabular-nums">
                    <a
                      href={`/section/${s.section_code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.section_code}
                    </a>
                  </td>
                  <td className="px-2 py-1.5">{s.settlement_name ?? "—"}</td>
                  <td className="px-2 py-1.5"><ScoreBadge value={s.persistence_score} /></td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-semibold tabular-nums">{s.elections_flagged}</span>
                      <span className="text-muted-foreground">/ {s.elections_present}</span>
                      <div className="ml-1 flex gap-px">
                        {Array.from({ length: s.elections_present }, (_, i) => (
                          <div
                            key={i}
                            className={`h-1.5 w-1.5 rounded-full ${i < s.elections_flagged ? SCORE_SOLID_CLASS[scoreLevel(s.avg_risk)] : "bg-gray-300"}`}
                          />
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-2 py-1.5 font-mono tabular-nums md:table-cell">
                    {(s.consistency * 100).toFixed(0)}%
                  </td>
                  <td className="hidden px-2 py-1.5 md:table-cell"><ScoreBadge value={s.avg_risk} /></td>
                  <td className="hidden px-2 py-1.5 lg:table-cell"><ScoreBadge value={s.max_risk} /></td>
                  <td className="hidden px-2 py-1.5 md:table-cell">
                    <span className={`font-mono font-semibold tabular-nums ${s.avg_turnout > 1 ? "text-red-600" : ""}`}>
                      {(s.avg_turnout * 100).toFixed(1)}%
                    </span>
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({s.avg_voted}/{s.avg_registered})
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <FlagDots section={s} electionsCount={s.elections_present} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

        {/* Section preview sidebar */}
        {expandedSection && (
          <div className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background shadow-lg md:w-[540px]">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="font-mono text-sm font-semibold">{expandedSection}</span>
              <button
                onClick={() => setParam({ preview: null })}
                className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <SectionPreview sectionCode={expandedSection} />
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border bg-background px-3 py-1.5">
          <button
            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            disabled={offset === 0}
            onClick={() => setParam({ offset: offset - LIMIT <= 0 ? null : String(offset - LIMIT) })}
          >
            ← Назад
          </button>
          <span className="text-[11px] text-muted-foreground">
            Стр. {currentPage} от {totalPages}
          </span>
          <button
            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            disabled={offset + LIMIT >= data.total}
            onClick={() => setParam({ offset: String(offset + LIMIT) })}
          >
            Напред →
          </button>
        </div>
      )}
    </div>
  );
}
