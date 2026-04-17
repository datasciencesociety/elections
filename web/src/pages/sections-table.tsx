import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import Sidebar from "@/components/sidebar.js";
import { SectionView } from "@/components/section/index.js";
import MethodologyExplainer from "@/components/methodology-explainer.js";
import SectionSearchInput from "@/components/section-search-input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnomalySection } from "@/lib/api/types.js";
import { useAnomaliesInfinite } from "@/lib/hooks/use-anomalies.js";
import { useDistricts, useMunicipalities } from "@/lib/hooks/use-geography.js";
import { useSectionViolations } from "@/lib/hooks/use-sections.js";
import { ScoreBadge } from "@/components/score/index.js";
import { SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import AppFooter from "@/components/app-footer.js";

function pct2(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

function TurnoutSparkline({ values, current }: { values: number[]; current: number }) {
  if (values.length < 2) return null;
  const W = 48;
  const H = 20;
  const pad = 1;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.01;
  const x = (i: number) => pad + ((W - 2 * pad) * i) / (values.length - 1);
  const y = (v: number) => H - pad - ((H - 2 * pad) * (v - min)) / range;
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const currentIdx = values.length - 1;
  const currentY = y(current);
  const pcts = values.map((v) => `${(v * 100).toFixed(0)}%`);
  const title = `Активност през ${values.length} избора: ${pcts.join(" → ")}`;
  return (
    <svg width={W} height={H} className="inline-block align-middle" aria-label={title}>
      <title>{title}</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        className="text-muted-foreground/50"
      />
      <circle cx={x(currentIdx)} cy={currentY} r={2} className="fill-foreground" />
    </svg>
  );
}

const SECTION_TYPE_LABELS: Record<string, string> = {
  mobile: "Подвижна",
  hospital: "Болница",
  abroad: "Чужбина",
  prison: "Затвор",
};

type RiskSection = AnomalySection;
type SortColumn = "risk_score" | "benford_risk" | "peer_risk" | "acf_risk" | "turnout_rate" | "section_code" | "settlement_name" | "protocol_violation_count" | "registered_voters" | "actual_voters";

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
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-left text-xs font-medium transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      } ${className ?? ""}`}
      onClick={() => onSort(column)}
      title={tooltip}
    >
      {label}
      <span className={active ? "ml-0.5" : "ml-0.5 opacity-30"}>
        {active ? (currentOrder === "desc" ? " ↓" : " ↑") : " ↕"}
      </span>
    </th>
  );
}

function ViolationDetail({ electionId, sectionCode }: { electionId: string; sectionCode: string }) {
  const { data, isLoading } = useSectionViolations(electionId, sectionCode);
  if (isLoading) return <span className="text-2xs text-muted-foreground">...</span>;
  const violations = data?.violations ?? [];
  if (violations.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {violations.map((v, i) => (
        <div
          key={i}
          className={`rounded px-2 py-1 text-2xs ${
            v.severity === "error" ? "bg-score-high/10 text-score-high" : "bg-score-medium/10 text-score-medium"
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

  const sort = (searchParams.get("sort") ?? "protocol_violation_count") as SortColumn;
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";
  const district = searchParams.get("district") ?? "";
  const municipality = searchParams.get("municipality") ?? "";
  const sectionFilter = searchParams.get("q") ?? "";
  const selectedCode = searchParams.get("section") ?? "";
  const expandedCode = searchParams.get("expand") ?? "";

  const setParam = useCallback(
    (key: string, value: string, opts?: { push?: boolean }) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      }, { replace: !opts?.push });
    },
    [setSearchParams],
  );

  const toggleSection = useCallback(
    (code: string) => {
      const opening = !selectedCode && selectedCode !== code;
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (prev.get("section") === code) next.delete("section");
        else next.set("section", code);
        return next;
      }, { replace: !opening });
    },
    [setSearchParams, selectedCode],
  );

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

  const {
    data: anomaliesData,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAnomaliesInfinite(
    {
      electionId: electionId!,
      minRisk: 0,
      sort,
      order,
      district: district || undefined,
      municipality: municipality || undefined,
      section: sectionFilter || undefined,
    },
    PAGE_SIZE,
  );

  // Flatten paged results into a single section list. Memoised so changing
  // row hover doesn't rebuild the array.
  const sections: RiskSection[] = useMemo(
    () => anomaliesData?.pages.flatMap((p) => p.sections) ?? [],
    [anomaliesData],
  );
  const total = anomaliesData?.pages[0]?.total ?? 0;
  const election = anomaliesData?.pages[0]?.election;

  const selectedSection = selectedCode
    ? sections.find((s) => s.section_code === selectedCode) ?? null
    : null;

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

  // Dynamic document title so users with multiple tabs open can tell them apart.
  useEffect(() => {
    const base = "Таблица на секции · Изборен монитор";
    document.title = election ? `Таблица · ${election.name} · Изборен монитор` : base;
    return () => { document.title = "Изборен монитор"; };
  }, [election?.name]);

  // Human-readable summary of the filters currently applied — shown in a
  // small strip above the table so a shared link can be understood at a
  // glance without reverse-engineering URL params.
  const activeFilters: string[] = [];
  if (district) {
    const d = districts.find((x) => String(x.id) === district);
    if (d) activeFilters.push(`област ${d.name}`);
  }
  if (municipality) {
    const m = municipalities.find((x) => String(x.id) === municipality);
    if (m) activeFilters.push(`община ${m.name}`);
  }
  if (sectionFilter) activeFilters.push(`секция ${sectionFilter}`);
  const sortLabelMap: Record<SortColumn, string> = {
    risk_score: "обобщена оценка",
    benford_risk: "Бенфорд",
    peer_risk: "сравнение със съседи",
    acf_risk: "АКФ",
    turnout_rate: "активност",
    section_code: "№ секция",
    settlement_name: "населено място",
    protocol_violation_count: "нарушения",
    registered_voters: "списък",
    actual_voters: "гласували",
  };
  const sortLabel = sortLabelMap[sort] ?? sort;

  return (
    <div className={`flex h-full flex-col overflow-hidden ${selectedSection ? "md:pr-sidebar" : ""}`}>
      {/* Page header — intro + collapsible methodology */}
      <div className="shrink-0 border-b border-border bg-background px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="font-display text-base font-semibold tracking-tight md:text-lg">
            Таблица на избирателните секции
          </h1>
          {election && (
            <span className="text-xs text-muted-foreground">
              {election.name}
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {loading ? "..." : <><b className="text-foreground">{total.toLocaleString("bg-BG")}</b> секции</>}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Всяка секция в тези избори. Кликнете върху заглавие на колона за
          сортиране, върху ред — за детайли.
        </p>
        <MethodologyExplainer variant="inline" className="mt-2" />
      </div>

      {/* Filters bar — collapsible on mobile, always-open on desktop */}
      <FiltersBar
        district={district}
        municipality={municipality}
        sectionFilter={sectionFilter}
        districts={districts}
        municipalities={municipalities}
        setParam={setParam}
        setSearchParams={setSearchParams}
        activeFilterCount={activeFilters.length}
      />

      {/* Active filters summary — makes shared links self-describing */}
      <div className="shrink-0 border-b border-border bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground md:px-4">
        <span className="font-medium text-foreground tabular-nums">
          {loading ? "..." : total.toLocaleString("bg-BG")}
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
            if (v) setSort(v as SortColumn);
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
          onClick={() => setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("order", order === "desc" ? "asc" : "desc");
            return next;
          }, { replace: true })}
          className="flex size-7 items-center justify-center rounded-md border border-input text-xs"
        >
          {order === "desc" ? "↓" : "↑"}
        </button>
      </div>

      {/* Mobile cards */}
      <div className="flex-1 overflow-auto md:hidden">
        <div className="divide-y divide-border">
          {sections.map((s) => (
            <div
              key={s.section_code}
              onClick={() => toggleSection(s.section_code)}
              className={`cursor-pointer px-3 py-2.5 transition-colors active:bg-secondary/50 ${
                selectedCode === s.section_code ? "bg-secondary" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs tabular-nums">{s.section_code}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground truncate">{s.settlement_name}</span>
                  {SECTION_TYPE_LABELS[s.section_type] && (
                    <span className="ml-1 rounded bg-muted px-1 py-0.5 text-2xs font-medium">{SECTION_TYPE_LABELS[s.section_type]}</span>
                  )}
                </div>
                <ScoreBadge value={s.risk_score} size="lg" />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Списък <span className="font-mono tabular-nums text-foreground">{(s.registered_voters ?? 0).toLocaleString()}</span></span>
                <span className="text-muted-foreground">Гласували <span className="font-mono tabular-nums text-foreground">{(s.actual_voters ?? 0).toLocaleString()}</span></span>
                <span className="text-muted-foreground">Активност <span className={`font-mono font-semibold tabular-nums ${s.turnout_rate > 1 ? "text-score-high" : "text-foreground"}`}>{pct2(s.turnout_rate * 100)}%</span></span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-2xs text-muted-foreground">B</span><ScoreBadge value={s.benford_risk} />
                <span className="text-2xs text-muted-foreground">P</span><ScoreBadge value={s.peer_risk} />
                <span className="text-2xs text-muted-foreground">A</span><ScoreBadge value={s.acf_risk} />
                {s.acf_multicomponent >= 1 && (
                  <span className="rounded bg-score-medium/10 px-1 py-0.5 text-2xs text-score-medium">×3</span>
                )}
                {s.protocol_violation_count > 0 && (
                  <span className={`rounded px-1 py-0.5 text-2xs font-mono font-semibold ${
                    s.protocol_violation_count >= 3 ? "bg-score-high/10 text-score-high" : "bg-score-medium/10 text-score-medium"
                  }`}>
                    Пр:{s.protocol_violation_count}
                  </span>
                )}
                {s.arithmetic_error > 0 && <span className="rounded bg-score-high/10 px-1 py-0.5 text-2xs text-score-high">АГ</span>}
                {s.vote_sum_mismatch > 0 && <span className="rounded bg-score-high/10 px-1 py-0.5 text-2xs text-score-high">НС</span>}
              </div>
            </div>
          ))}
          {!loading && sections.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Няма секции, отговарящи на филтрите
            </div>
          )}
          {hasNextPage && (
            <div ref={mobileSentinelRef} className="px-4 py-6 text-center text-xs text-muted-foreground">
              {isFetchingNextPage ? "Зареждане..." : `Зареждам следващи секции (${sections.length} / ${total.toLocaleString("bg-BG")})`}
            </div>
          )}
        </div>
        <AppFooter />
      </div>

      {/* Desktop table */}
      <div className="hidden flex-1 overflow-auto md:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-background">
            <tr>
              <SortHeader label="Секция" column="section_code" currentSort={sort} currentOrder={order} onSort={setSort} tooltip="Номер на избирателна секция. Кликнете за сортиране." />
              <SortHeader label="Населено място" column="settlement_name" currentSort={sort} currentOrder={order} onSort={setSort} tooltip="Град или село на секцията. Кликнете за сортиране." />
              <SortHeader
                label="Списък"
                column="registered_voters"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Брой избиратели в списъка на секцията (регистрирани да гласуват)."
              />
              <SortHeader
                label="Гласували"
                column="actual_voters"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Брой реално гласували в секцията."
              />
              <SortHeader
                label="Активност"
                column="turnout_rate"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Активност (гласували / списък). Стойност над 100% е физически невъзможна и означава грешка в протокола."
              />
              <th className="hidden px-2 py-2 text-left text-xs font-medium text-muted-foreground lg:table-cell" title="Как се е променяла активността на тази секция през всички избори. Линията показва % гласували, точката е текущият избор.">
                Активност ⟶
              </th>
              <SortHeader
                label="Оценка"
                column="risk_score"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Обобщена оценка: среднопретеглена от Бенфорд, сравнение със съседи и пространствени модели. 0 = в нормата, 1 = силно отклонение."
              />
              <SortHeader
                label="Benford"
                column="benford_risk"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Разпределение на първите цифри на броя гласове. Закон на Бенфорд. Високи стойности = числата не следват естествен модел на броене."
              />
              <SortHeader
                label="Съседи"
                column="peer_risk"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Сравнение със съседните секции от същото населено място. Високи стойности = рязко отклонение от съседите."
              />
              <SortHeader
                label="АКФ"
                column="acf_risk"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Методология на Антикорупционен фонд: (1) нетипична активност или резултат спрямо общината, (2) рязка промяна в активността между два избора, (3) рязка промяна в политическите пристрастия. ×3 = и трите проверки са задействани."
              />
              <SortHeader
                label="Протокол"
                column="protocol_violation_count"
                currentSort={sort}
                currentOrder={order}
                onSort={setSort}
                tooltip="Брой грешки в протокола — числата не се събират правилно. АГ = аритметична грешка (гласували ≠ валидни + невалидни), НС = несъвпадение на сумите (гласове по партии ≠ общо валидни)."
              />
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <>
                <tr
                  key={s.section_code}
                  onClick={() => toggleSection(s.section_code)}
                  className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-secondary/50 ${
                    selectedCode === s.section_code ? "bg-secondary" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">{s.section_code}</td>
                  <td className="max-w-cell-name px-2 py-1.5" title={s.settlement_name}>
                    <span className="flex items-center gap-1">
                      <span className="truncate">{s.settlement_name}</span>
                      {SECTION_TYPE_LABELS[s.section_type] && (
                        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-2xs font-medium">{SECTION_TYPE_LABELS[s.section_type]}</span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
                    {(s.registered_voters ?? 0).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
                    {(s.actual_voters ?? 0).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={`font-mono font-semibold tabular-nums ${s.turnout_rate > 1 ? "text-score-high" : ""}`}>
                      {pct2(s.turnout_rate * 100)}%
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-1.5 lg:table-cell">
                    {s.turnout_history && s.turnout_history.length >= 2 && (
                      <TurnoutSparkline values={s.turnout_history} current={s.turnout_rate} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5"><ScoreBadge value={s.risk_score} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5"><ScoreBadge value={s.benford_risk} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5"><ScoreBadge value={s.peer_risk} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <ScoreBadge value={s.acf_risk} />
                      {s.acf_multicomponent >= 1 && (
                        <span
                          className="rounded bg-score-medium/10 px-1 py-0.5 text-2xs text-score-medium"
                          title="АКФ в три режима: секцията показва необичайни пространствени модели едновременно по активност, победител и невалидни."
                        >
                          ×3
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      {s.protocol_violation_count > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchParams((prev) => {
                              const next = new URLSearchParams(prev);
                              if (expandedCode === s.section_code) next.delete("expand");
                              else next.set("expand", s.section_code);
                              return next;
                            }, { replace: true });
                          }}
                          className={`rounded px-1.5 py-0.5 text-xs font-mono font-semibold tabular-nums ${
                            s.protocol_violation_count >= 3 ? "bg-score-high/10 text-score-high" : "bg-score-medium/10 text-score-medium"
                          }`}
                        >
                          {s.protocol_violation_count} {expandedCode === s.section_code ? "▲" : "▼"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">0</span>
                      )}
                      {s.arithmetic_error ? (
                        <span
                          className="rounded bg-score-high/10 px-1 py-0.5 text-2xs text-score-high"
                          title="Аритметична грешка: общо гласували ≠ валидни + невалидни. Протоколът не се сумира правилно."
                        >
                          АГ
                        </span>
                      ) : null}
                      {s.vote_sum_mismatch ? (
                        <span
                          className="rounded bg-score-high/10 px-1 py-0.5 text-2xs text-score-high"
                          title="Несъвпадение на сумите: сборът на гласовете по партии не съвпада с общите валидни гласове."
                        >
                          НС
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {expandedCode === s.section_code && s.protocol_violation_count > 0 && electionId && (
                  <tr key={`${s.section_code}-expand`} className="border-b border-border/50">
                    <td colSpan={12} className="bg-muted/30 px-2 py-2">
                      <ViolationDetail electionId={electionId} sectionCode={s.section_code} />
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!loading && sections.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                  Няма секции, отговарящи на филтрите
                </td>
              </tr>
            )}
            {hasNextPage && (
              <tr ref={desktopSentinelRef}>
                <td
                  colSpan={12}
                  className="px-4 py-6 text-center text-xs text-muted-foreground"
                >
                  {isFetchingNextPage
                    ? "Зареждане..."
                    : `Зареждам следващи секции (${sections.length} / ${total.toLocaleString("bg-BG")})`}
                </td>
              </tr>
            )}
            {!hasNextPage && sections.length > 0 && sections.length < total && (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-6 text-center text-xs text-muted-foreground"
                >
                  {sections.length.toLocaleString("bg-BG")} /{" "}
                  {total.toLocaleString("bg-BG")} секции
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <AppFooter />
      </div>

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

/**
 * Filters bar — one place for every filter control. Full-width horizontal
 * on desktop; on mobile collapses behind a single "Филтри · N" toggle so
 * the table gets the full viewport.
 *
 * Kept as a sibling component (not inline) so the main page body is easier
 * to scan and the collapse state lives in its own hook.
 */
function FiltersBar(props: {
  district: string;
  municipality: string;
  sectionFilter: string;
  districts: { id: number | string; name: string }[];
  municipalities: { id: number | string; name: string }[];
  setParam: (key: string, value: string) => void;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  activeFilterCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    district,
    municipality,
    sectionFilter,
    districts,
    municipalities,
    setSearchParams,
    activeFilterCount,
  } = props;

  return (
    <div className="shrink-0 border-b border-border bg-background">
      {/* Mobile toggle — hidden on desktop */}
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
        {/* District */}
        <div className="min-w-0 sm:w-44">
          <div className="mb-0.5 text-xs text-muted-foreground">Област</div>
          <Select
            value={district || "all"}
            onValueChange={(v: string | null) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (v && v !== "all") next.set("district", v);
                else next.delete("district");
                next.delete("municipality");
                next.delete("page");
                return next;
              }, { replace: true });
            }}
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue>
                {district
                  ? districts.find((d) => String(d.id) === district)?.name ?? "—"
                  : "Всички"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всички</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Municipality */}
        <div className="min-w-0 sm:w-44">
          <div className="mb-0.5 text-xs text-muted-foreground">Община</div>
          <Select
            value={municipality || "all"}
            onValueChange={(v: string | null) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (v && v !== "all") next.set("municipality", v);
                else next.delete("municipality");
                next.delete("page");
                return next;
              }, { replace: true });
            }}
            disabled={!district}
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue>
                {municipality
                  ? municipalities.find((m) => String(m.id) === municipality)?.name ?? "—"
                  : "Всички"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всички</SelectItem>
              {municipalities.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Section search — fuzzy by address OR exact number */}
        <div className="min-w-0 flex-1 sm:flex-none sm:w-64">
          <div className="mb-0.5 text-xs text-muted-foreground">Секция / адрес</div>
          <SectionSearchInput
            value={sectionFilter}
            onPick={(code) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (code) next.set("q", code);
                else next.delete("q");
                next.delete("page");
                return next;
              }, { replace: true });
            }}
          />
        </div>
      </div>
    </div>
  );
}
