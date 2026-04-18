import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SectionSearchInput from "@/components/section-search-input.js";
import { useDistricts, useMunicipalities } from "@/lib/hooks/use-geography.js";
import type { AnomalyMethodology } from "@/lib/api/types.js";
import {
  ALL_SECTION_TYPES,
  SECTION_TYPE_LABELS,
  SPECIAL_SECTION_TYPES,
  type SectionTypeKey,
} from "@/lib/section-types.js";

const METHODOLOGIES: { key: AnomalyMethodology; label: string }[] = [
  { key: "protocol", label: "Протокол" },
  { key: "combined", label: "Обобщена" },
  { key: "benford", label: "Бенфорд" },
  { key: "peer", label: "Съседи" },
  { key: "acf", label: "АКФ" },
];

const DEFAULT_METHODOLOGY: AnomalyMethodology = "protocol";

function parseMethodology(raw: string | null): AnomalyMethodology {
  const found = METHODOLOGIES.find((m) => m.key === raw);
  return found ? found.key : DEFAULT_METHODOLOGY;
}

/**
 * ONE filter component, used identically on every page that filters sections.
 * State lives in the URL — pages consume it via `useFilters()`.
 *
 * No children, no props, no per-page slots. If a page needs a control that
 * doesn't fit here, it goes elsewhere (inline in the header, floating on the
 * map, URL-only). This component does not accept variants.
 */
export function Filters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const district = searchParams.get("district") ?? "";
  const municipality = searchParams.get("municipality") ?? "";
  const sectionSearch = searchParams.get("q") ?? "";
  const sectionTypes = parseSectionTypes(searchParams.get("types"));
  const onlyAnomalies = searchParams.get("only") === "1";
  const methodology = parseMethodology(searchParams.get("m"));
  const [expanded, setExpanded] = useState(false);

  const { data: districts = [] } = useDistricts();
  const { data: municipalities = [] } = useMunicipalities(district || undefined);

  const update = (updates: Record<string, string | null>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        // Any filter change invalidates pagination across all pages.
        next.delete("offset");
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  };

  // Methodology switch resets per-page sort so every page falls back to its
  // methodology-appropriate default (sections-table sorts by the matching
  // risk column, persistence by the matching aggregate). Users can still
  // click a column header afterwards to override.
  const setMethodology = (m: AnomalyMethodology) => {
    update({
      m: m === DEFAULT_METHODOLOGY ? null : m,
      sort: null,
      order: null,
    });
  };

  const activeCount =
    (district ? 1 : 0) +
    (municipality ? 1 : 0) +
    (sectionSearch ? 1 : 0) +
    (hasSpecialExcluded(sectionTypes) ? 1 : 0) +
    (onlyAnomalies ? 1 : 0);

  return (
    <div className="shrink-0 border-b border-border bg-background">
      {/* Mobile toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left md:hidden"
      >
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
          <SlidersHorizontal size={14} />
          Филтри
          {activeCount > 0 && (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-2xs font-bold text-white">
              {activeCount}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground" />
        )}
      </button>

      {/* Methodology — the lens over the data. Below `2xl` it sits on its own
          row above the filter fields; at `2xl+` we collapse this row into the
          filter row so wide viewports only show one filter strip. `2xl` is
          the threshold because anything below that doesn't have the horizontal
          room to fit methodology + all six filter fields on one line. */}
      <div
        className={`items-center gap-4 border-b border-border/60 px-3 py-2 md:flex md:px-4 md:py-2.5 2xl:hidden ${
          expanded ? "flex" : "hidden md:flex"
        }`}
      >
        <span className="shrink-0 text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
          Методология
        </span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {METHODOLOGIES.map((m) => {
            const active = methodology === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethodology(m.key)}
                className={`text-sm transition-colors ${
                  active
                    ? "brand-underline text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`flex-wrap items-end gap-3 px-3 py-2 md:flex md:gap-4 md:px-4 md:py-3 ${
          expanded ? "flex" : "hidden md:flex"
        }`}
      >
        {/* Methodology — inline with the fields at `2xl+` only, where there
            is enough horizontal room for all six fields on one line. */}
        <div className="hidden items-end gap-4 2xl:flex">
          <Field label="Методология">
            <div className="flex h-8 items-center gap-x-4">
              {METHODOLOGIES.map((m) => {
                const active = methodology === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMethodology(m.key)}
                    className={`text-sm transition-colors ${
                      active
                        ? "brand-underline text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <span className="mb-2 h-6 w-px bg-border" aria-hidden="true" />
        </div>

        {/* District */}
        <Field label="Област" className="sm:w-44">
          <Select
            value={district || "all"}
            onValueChange={(v: string | null) =>
              update({
                district: v == null || v === "all" ? null : v,
                municipality: null,
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-sm font-medium">
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
        </Field>

        {/* Municipality */}
        <Field label="Община" className="sm:w-44">
          <Select
            value={municipality || "all"}
            onValueChange={(v: string | null) =>
              update({ municipality: v == null || v === "all" ? null : v })
            }
            disabled={!district}
          >
            <SelectTrigger size="sm" className="w-full text-sm font-medium">
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
        </Field>

        {/* Section search — flexes to fill the remaining row at every size so
            the bar never horizontal-scrolls. Capped on large viewports so it
            doesn't swallow the row. */}
        <Field label="Секция / адрес" className="w-full sm:flex-1 sm:min-w-60 lg:max-w-sm">
          <SectionSearchInput
            value={sectionSearch}
            onPick={(code) => update({ q: code || null })}
          />
        </Field>

        {/* Right cluster — type + only-anomalies. Divider only at lg+, where
            the cluster reliably sits on the same row; below lg it wraps and
            an orphaned left-border looks wrong. */}
        <div className="flex flex-wrap items-end gap-3 md:ml-auto md:gap-4 lg:border-l lg:border-border lg:pl-4">
          <Field label="Тип секция" className="sm:w-44">
            <SectionTypesPicker
              value={sectionTypes}
              onChange={(next) => update({ types: serializeSectionTypes(next) })}
            />
          </Field>

          <label className="flex h-8 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyAnomalies}
              onChange={(e) => update({ only: e.target.checked ? "1" : null })}
              className="size-4 accent-foreground"
            />
            Само аномалии
          </label>
        </div>
      </div>
    </div>
  );
}

/** Hook that returns the current filter state from the URL. Pages call this
 *  to build their queries. */
export function useFilters() {
  const [searchParams] = useSearchParams();
  return {
    district: searchParams.get("district") ?? "",
    municipality: searchParams.get("municipality") ?? "",
    sectionSearch: searchParams.get("q") ?? "",
    sectionTypes: parseSectionTypes(searchParams.get("types")),
    onlyAnomalies: searchParams.get("only") === "1",
    methodology: parseMethodology(searchParams.get("m")),
  };
}

export function hasSpecialExcluded(value: Set<SectionTypeKey>): boolean {
  return SPECIAL_SECTION_TYPES.some((k) => !value.has(k));
}

// ---------- internals ----------

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1 text-2xs font-medium uppercase tracking-eyebrow text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function SectionTypesPicker({
  value,
  onChange,
}: {
  value: Set<SectionTypeKey>;
  onChange: (next: Set<SectionTypeKey>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (key: SectionTypeKey) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm transition-colors hover:bg-accent"
      >
        <span className="truncate">{summarizeTypes(value)}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="dropdown-panel">
          <div className="p-2">
            {ALL_SECTION_TYPES.map((key) => {
              const checked = value.has(key);
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(key)}
                    className="size-4 accent-foreground"
                  />
                  <span>{SECTION_TYPE_LABELS[key]}</span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
            <button
              type="button"
              onClick={() => onChange(new Set(ALL_SECTION_TYPES))}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Всички
            </button>
            <button
              type="button"
              onClick={() => onChange(new Set(["normal"]))}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Без специални
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeTypes(value: Set<SectionTypeKey>): string {
  if (value.size === 0) return "Никакви";
  if (value.size === ALL_SECTION_TYPES.length) return "Всички";
  if (value.size === 1 && value.has("normal")) return "Без специални";
  const keys = ALL_SECTION_TYPES.filter((k) => value.has(k));
  if (keys.length <= 2) return keys.map((k) => SECTION_TYPE_LABELS[k]).join(", ");
  return `${keys.length} типа`;
}

function serializeSectionTypes(value: Set<SectionTypeKey>): string | null {
  if (value.size === ALL_SECTION_TYPES.length) return null;
  if (value.size === 1 && value.has("normal")) return "normal";
  const keys = ALL_SECTION_TYPES.filter((k) => value.has(k));
  return keys.join(",") || "none";
}

function parseSectionTypes(raw: string | null): Set<SectionTypeKey> {
  if (!raw) return new Set(ALL_SECTION_TYPES);
  if (raw === "none") return new Set();
  const parts = raw.split(",").filter((p): p is SectionTypeKey =>
    (ALL_SECTION_TYPES as string[]).includes(p),
  );
  return new Set(parts.length ? parts : ALL_SECTION_TYPES);
}
