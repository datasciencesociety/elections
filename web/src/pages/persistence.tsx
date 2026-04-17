import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import SectionPreview from "@/components/section-preview.js";
import Sidebar from "@/components/sidebar.js";
import MethodologyExplainer from "@/components/methodology-explainer.js";
import SectionSearchInput from "@/components/section-search-input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PersistenceSection as PersistentSection } from "@/lib/api/types.js";
import { usePersistenceInfinite } from "@/lib/hooks/use-persistence.js";
import AppFooter from "@/components/app-footer.js";
import {
  ScoreBadge,
  SCORE_SOLID_CLASS,
  scoreLevel,
} from "@/components/score/index.js";
import { SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";

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
    {
      label: "B",
      count: section.benford_flags,
      color: "bg-blue-500",
      full: "Бенфорд",
    },
    {
      label: "P",
      count: section.peer_flags,
      color: "bg-amber-500",
      full: "Сравнение със съседни секции",
    },
    {
      label: "A",
      count: section.acf_flags,
      color: "bg-purple-500",
      full: "АКФ (авто-корелация)",
    },
    {
      label: "Пр",
      count: section.protocol_flags,
      color: "bg-score-high/100",
      full: "Протоколни нарушения",
    },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {items.map((item) =>
        item.count > 0 ? (
          <span
            key={item.label}
            className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-2xs font-medium text-white ${item.color}`}
            title={`${item.full}: отбелязан в ${item.count} от ${electionsCount} избори`}
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
  tooltip,
}: {
  label: string;
  column: SortColumn;
  currentSort: SortColumn;
  currentOrder: "asc" | "desc";
  onSort: (col: SortColumn) => void;
  className?: string;
  tooltip?: string;
}) {
  const active = currentSort === column;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground ${className ?? ""}`}
      onClick={() => onSort(column)}
      title={tooltip}
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
  const minElections = parseInt(searchParams.get("min") ?? "5", 10);
  const excludeSpecial = searchParams.get("special") !== "1";
  const expandedSection = searchParams.get("preview") ?? null;
  const sectionSearch = searchParams.get("q") ?? "";

  const setParam = useCallback(
    (
      updates: Record<string, string | null>,
      opts?: { push?: boolean },
    ) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      }, { replace: !opts?.push });
    },
    [setSearchParams],
  );

  const {
    data: pages,
    isLoading: loading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePersistenceInfinite(
    {
      sort,
      order,
      minElections,
      excludeSpecial,
      section: sectionSearch || undefined,
    },
    LIMIT,
  );
  const error = isError ? "Грешка при зареждане" : null;

  // Flatten paged persistence results. The first page carries the total
  // count and the election_count — everything else is concatenated rows.
  const sections = useMemo(
    () => pages?.pages.flatMap((p) => p.sections) ?? [],
    [pages],
  );
  const total = pages?.pages[0]?.total ?? 0;
  const electionsCount = pages?.pages[0]?.elections_count ?? 0;
  const data = pages?.pages[0]
    ? { ...pages.pages[0], sections, total }
    : null;

  const handleSort = (col: SortColumn) => {
    if (sort === col) {
      setParam({ order: order === "desc" ? "asc" : "desc" });
    } else {
      setParam({ sort: col, order: "desc" });
    }
  };

  const mobileSentinelRef = useRef<HTMLDivElement>(null);
  const desktopSentinelRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const nodes = [mobileSentinelRef.current, desktopSentinelRef.current].filter(Boolean) as Element[];
    if (nodes.length === 0 || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Dynamic document title
  useEffect(() => {
    document.title = "Системни сигнали · Изборен монитор";
    return () => { document.title = "Изборен монитор"; };
  }, []);

  // Human-readable filter summary
  const activeFilters: string[] = [];
  if (minElections !== 5) activeFilters.push(`мин. ${minElections} избори`);
  if (!excludeSpecial) activeFilters.push("със специални секции");
  if (sectionSearch) activeFilters.push(`секция ${sectionSearch}`);
  const sortLabelMap: Record<SortColumn, string> = {
    persistence_score: "индекс",
    elections_flagged: "отбелязани избори",
    consistency: "консистентност",
    avg_risk: "среден риск",
    max_risk: "максимален риск",
    total_violations: "нарушения",
    section_code: "№ секция",
    settlement_name: "населено място",
    avg_registered: "ср. списък",
    avg_voted: "ср. гласували",
    avg_turnout: "ср. активност",
  };
  const sortLabel = sortLabelMap[sort] ?? sort;

  return (
    <div className={`flex h-full flex-col overflow-hidden ${expandedSection ? "md:pr-sidebar" : ""}`}>
      {/* Page header — intro + collapsible methodology */}
      <div className="shrink-0 border-b border-border bg-background px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="font-display text-base font-semibold tracking-tight md:text-lg">
            Системни сигнали във времето
          </h1>
          {electionsCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {electionsCount} избори от 2021 г. насам
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {loading ? "..." : data ? <><b className="text-foreground">{data.total.toLocaleString("bg-BG")}</b> секции</> : null}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Секции, в които статистически сигнали се появяват повтарящо се
          в множество избори. Индексът комбинира средния риск с това колко
          често секцията показва отклонения. По-високата стойност значи
          по-системно повтарящ се сигнал.
        </p>
        <MethodologyExplainer variant="inline" className="mt-2" />
      </div>

      {/* Controls — collapsible on mobile */}
      <PersistenceFiltersBar
        minElections={minElections}
        excludeSpecial={excludeSpecial}
        sectionSearch={sectionSearch}
        setParam={setParam}
        activeFilterCount={activeFilters.length}
      />

      {/* Active filters summary */}
      <div className="shrink-0 border-b border-border bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground md:px-4">
        <span className="font-medium text-foreground tabular-nums">
          {loading ? "..." : data ? data.total.toLocaleString("bg-BG") : "—"}
        </span>{" "}
        секции · сортирано по <span className="text-foreground">{sortLabel}</span>{" "}
        {order === "desc" ? "↓" : "↑"}
        {activeFilters.length > 0 && (
          <>
            {" · филтри: "}
            <span className="text-foreground">{activeFilters.join(" · ")}</span>
          </>
        )}
      </div>

      {/* Mobile sort bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2 md:hidden">
        <span className="text-xs text-muted-foreground">Сортирай:</span>
        <Select
          value={sort}
          onValueChange={(v: string | null) => {
            if (v) handleSort(v as SortColumn);
          }}
        >
          <SelectTrigger size="sm" className="flex-1 text-xs">
            <SelectValue>{sortLabelMap[sort]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(sortLabelMap) as [SortColumn, string][]).map(([col, label]) => (
              <SelectItem key={col} value={col}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => setParam({ order: order === "desc" ? "asc" : "desc" })}
          className="flex size-7 items-center justify-center rounded-md border border-input text-xs"
        >
          {order === "desc" ? "↓" : "↑"}
        </button>
      </div>

      {/* Mobile cards */}
      <div className="flex-1 overflow-auto md:hidden">
        {error && <div className="p-4 text-sm text-score-high">{error}</div>}
        {loading && !data && <div className="p-4 text-sm text-muted-foreground">Зареждане...</div>}
        {data && (
          <div className="divide-y divide-border">
            {sections.map((s) => (
              <div
                key={s.section_code}
                className={`cursor-pointer px-3 py-2.5 transition-colors active:bg-muted/50 ${expandedSection === s.section_code ? "bg-muted/50" : ""}`}
                onClick={() => {
                  const opening = !expandedSection && expandedSection !== s.section_code;
                  setParam(
                    { preview: expandedSection === s.section_code ? null : s.section_code },
                    { push: opening },
                  );
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <a
                      href={`/section/${s.section_code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs tabular-nums hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.section_code}
                    </a>
                    <span className="ml-1.5 text-xs text-muted-foreground">{s.settlement_name ?? "—"}</span>
                  </div>
                  <ScoreBadge value={s.persistence_score} size="lg" />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">
                    Отбелязани <span className="font-mono font-semibold tabular-nums text-foreground">{s.elections_flagged}</span>
                    <span className="text-muted-foreground">/{s.elections_present}</span>
                  </span>
                  <span className="text-muted-foreground">Консист. <span className="font-mono tabular-nums text-foreground">{(s.consistency * 100).toFixed(0)}%</span></span>
                  <span className="text-muted-foreground">Ср. риск <ScoreBadge value={s.avg_risk} /></span>
                  <span className="text-muted-foreground">Макс. <ScoreBadge value={s.max_risk} /></span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Списък <span className="font-mono tabular-nums text-foreground">{s.avg_registered.toLocaleString("bg-BG")}</span></span>
                  <span className="text-muted-foreground">Гласували <span className="font-mono tabular-nums text-foreground">{s.avg_voted.toLocaleString("bg-BG")}</span></span>
                  <span className="text-muted-foreground">Активност <span className={`font-mono font-semibold tabular-nums ${s.avg_turnout > 1 ? "text-score-high" : "text-foreground"}`}>{(s.avg_turnout * 100).toFixed(1)}%</span></span>
                </div>
                <div className="mt-1.5">
                  <FlagDots section={s} electionsCount={s.elections_present} />
                </div>
              </div>
            ))}
            {hasNextPage && (
              <div ref={mobileSentinelRef} className="px-4 py-6 text-center text-xs text-muted-foreground">
                {isFetchingNextPage ? "Зареждане..." : `Зареждам следващи секции (${sections.length} / ${total.toLocaleString("bg-BG")})`}
              </div>
            )}
          </div>
        )}
        <AppFooter />
      </div>

      {/* Desktop table */}
      <div className="hidden flex-1 overflow-auto md:block">
        {error && <div className="p-4 text-sm text-score-high">{error}</div>}
        {loading && !data && <div className="p-4 text-sm text-muted-foreground">Зареждане...</div>}

        {data && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-background">
              <tr>
                <SortHeader
                  label="Секция"
                  column="section_code"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Номер на избирателна секция. Кликнете за сортиране."
                />
                <SortHeader
                  label="Населено място"
                  column="settlement_name"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Град или село. Кликнете за сортиране."
                />
                <SortHeader
                  label="Индекс"
                  column="persistence_score"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Персистенция: претеглен среден риск × корен от (отбелязани / присъствие). По-висока стойност значи по-системно повтарящ се сигнал. Първичната подредба."
                />
                <SortHeader
                  label="Отбелязани"
                  column="elections_flagged"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Колко избори са получили риск над 0.3 в тази секция, от общо избори с данни. Точките визуализират съотношението."
                />
                <SortHeader
                  label="Консист."
                  column="consistency"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Процент отбелязани спрямо общо избори. 100% = отбелязана във всеки избор, в който присъства."
                />
                <SortHeader
                  label="Ср. риск"
                  column="avg_risk"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Средна стойност на комбинирания риск през всички избори, в които секцията присъства."
                />
                <SortHeader
                  label="Макс."
                  column="max_risk"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  className="hidden lg:table-cell"
                  tooltip="Максималният комбиниран риск, достигнат в някой от изборите."
                />
                <SortHeader
                  label="Списък"
                  column="avg_registered"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Средно избиратели в списъка на секцията през всички избори."
                />
                <SortHeader
                  label="Гласували"
                  column="avg_voted"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Средно гласували в секцията през всички избори."
                />
                <SortHeader
                  label="Активност"
                  column="avg_turnout"
                  currentSort={sort}
                  currentOrder={order}
                  onSort={handleSort}
                  tooltip="Средна активност (гласували / списък). Стойност над 100% е физически невъзможна."
                />
                <th
                  className="px-2 py-2 text-left text-xs font-medium text-muted-foreground"
                  title="Колко избори са отбелязани от всяка методология. B = Бенфорд, P = сравнение със съседни секции, A = АКФ, Пр = протоколни нарушения. Задръжте курсор върху всеки маркер."
                >
                  Методологии
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <tr
                  key={s.section_code}
                  className={`cursor-pointer border-t border-border/50 transition-colors hover:bg-muted/50 ${expandedSection === s.section_code ? "bg-muted/50" : ""}`}
                  onClick={() => {
                  const opening = !expandedSection && expandedSection !== s.section_code;
                  setParam(
                    { preview: expandedSection === s.section_code ? null : s.section_code },
                    { push: opening },
                  );
                }}
                >
                  <td className="px-2 py-1.5 font-mono text-xs tabular-nums">
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
                            className={`h-1.5 w-1.5 rounded-full ${i < s.elections_flagged ? SCORE_SOLID_CLASS[scoreLevel(s.avg_risk)] : "bg-border"}`}
                          />
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">
                    {(s.consistency * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 py-1.5"><ScoreBadge value={s.avg_risk} /></td>
                  <td className="hidden px-2 py-1.5 lg:table-cell"><ScoreBadge value={s.max_risk} /></td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">
                    {s.avg_registered.toLocaleString("bg-BG")}
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">
                    {s.avg_voted.toLocaleString("bg-BG")}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`font-mono font-semibold tabular-nums ${s.avg_turnout > 1 ? "text-score-high" : ""}`}>
                      {(s.avg_turnout * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <FlagDots section={s} electionsCount={s.elections_present} />
                  </td>
                </tr>
              ))}
              {hasNextPage && (
                <tr ref={desktopSentinelRef}>
                  <td
                    colSpan={11}
                    className="px-4 py-6 text-center text-xs text-muted-foreground"
                  >
                    {isFetchingNextPage
                      ? "Зареждане..."
                      : `Зареждам следващи секции (${sections.length} / ${total.toLocaleString("bg-BG")})`}
                  </td>
                </tr>
              )}
              {!hasNextPage &&
                sections.length > 0 &&
                sections.length < total && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-4 py-6 text-center text-xs text-muted-foreground"
                    >
                      {sections.length.toLocaleString("bg-BG")} /{" "}
                      {total.toLocaleString("bg-BG")} секции
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        )}
        <AppFooter />
      </div>

      {/* Sidebar */}
      <Sidebar
        open={!!expandedSection}
        onClose={() => setParam({ preview: null })}
        title={expandedSection ?? undefined}
      >
        {expandedSection && (
          <SectionPreview sectionCode={expandedSection} />
        )}
      </Sidebar>

    </div>
  );
}

/** Filters bar — mobile-collapsible, reuses the same pattern as sections-table. */
function PersistenceFiltersBar(props: {
  minElections: number;
  excludeSpecial: boolean;
  sectionSearch: string;
  setParam: (updates: Record<string, string | null>) => void;
  activeFilterCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { minElections, excludeSpecial, sectionSearch, setParam, activeFilterCount } =
    props;

  return (
    <div className="shrink-0 border-b border-border bg-background">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left md:hidden"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <SlidersHorizontal size={13} />
          Филтри
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-2xs font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground" />
        )}
      </button>

      <div
        className={`flex-wrap items-end gap-2 px-2 py-2 md:flex md:gap-3 md:px-4 md:py-2.5 ${
          expanded ? "flex" : "hidden md:flex"
        }`}
      >
        <div
          title="Минимален брой избори, в които секцията трябва да присъства. По-висок праг изключва секции с малко данни и прави сигнала по-стабилен."
        >
          <div className="mb-0.5 text-xs text-muted-foreground">Мин. избори</div>
          <Select
            value={String(minElections)}
            onValueChange={(v: string | null) =>
              setParam({
                min: v && v !== "5" ? v : null,
                offset: null,
              })
            }
          >
            <SelectTrigger size="sm" className="w-24 text-xs">
              <SelectValue>{minElections}+</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[3, 5, 8, 10, 12].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}+
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className="flex items-end pb-1"
          title="Изключва подвижни секции, болници, кораби и затвори, където условията на гласуване се различават от нормалните и статистическите методи не важат."
        >
          <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={excludeSpecial}
              onChange={(e) =>
                setParam({
                  special: e.target.checked ? null : "1",
                  offset: null,
                })
              }
              className="size-3 accent-red-500"
            />
            Без специални
          </label>
        </div>

        <div className="min-w-0 flex-1 sm:flex-none sm:w-64">
          <div className="mb-0.5 text-xs text-muted-foreground">Секция / адрес</div>
          <SectionSearchInput
            value={sectionSearch}
            onPick={(code) => setParam({ q: code || null, offset: null })}
          />
        </div>
      </div>
    </div>
  );
}
