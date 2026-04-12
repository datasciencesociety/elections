import { useState } from "react";
import type { AnomalyMethodology, GeoEntity } from "@/lib/api/types.js";
import { SECTION_TYPE_LABELS } from "./map/constants.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Floating filter box (top-left). Owns its own "expanded on mobile" toggle
 * but every other piece of state is mirrored to the URL via the parent's
 * setters — keep it that way so refreshing the page restores the view.
 *
 * The methodology buttons are the primary lens selector; there's no
 * threshold slider because a pre-tuned default covers the cases we care
 * about.
 */

export type SectionTypeKey = "normal" | "hospital" | "prison" | "mobile" | "abroad";

interface FilterPanelProps {
  // values
  district: string;
  municipality: string;
  sectionFilter: string;
  methodology: AnomalyMethodology;
  onlyAnomalies: boolean;
  sectionTypes: Set<SectionTypeKey>;

  // setters
  setDistrict: (id: string) => void;
  setMunicipality: (id: string) => void;
  setSectionFilter: (q: string) => void;
  setMethodology: (m: AnomalyMethodology) => void;
  setOnlyAnomalies: (v: boolean) => void;
  toggleSectionType: (key: SectionTypeKey) => void;

  // lookups
  districts: GeoEntity[];
  municipalities: GeoEntity[];

  // derived counters for the bottom status line
  baseLoading: boolean;
  riskLoading: boolean;
  baseCount: number;
  filteredBaseCount: number;
  riskCountWithCoords: number;
}

const METHODOLOGIES: { key: AnomalyMethodology; label: string }[] = [
  { key: "protocol", label: "Протокол" },
  { key: "combined", label: "Обобщена" },
  { key: "benford", label: "Бенфорд" },
  { key: "peer", label: "Съседи" },
  { key: "acf", label: "АКФ" },
];

const SECTION_TYPES: { key: SectionTypeKey; label: string }[] = [
  { key: "normal", label: "Обикновени" },
  { key: "hospital", label: SECTION_TYPE_LABELS.hospital },
  { key: "prison", label: SECTION_TYPE_LABELS.prison },
  { key: "mobile", label: SECTION_TYPE_LABELS.mobile },
  { key: "abroad", label: SECTION_TYPE_LABELS.abroad },
];

export function FilterPanel(props: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="absolute top-2 left-2 z-10 flex max-w-[280px] flex-col gap-0 rounded-lg border border-border bg-background/96 shadow-lg backdrop-blur-sm md:left-3 md:top-3 md:min-w-[280px] md:max-w-[320px]">
      {/* Mobile expand/collapse header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between p-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden"
      >
        <span>Филтри</span>
        <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Section 1: Location */}
      <div
        className={`flex-col gap-2.5 p-3.5 pb-3 ${expanded ? "flex" : "hidden md:flex"}`}
      >
        <div className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:block">
          Местоположение
        </div>

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[11px] text-muted-foreground">Област</div>
            <Select
              value={props.district || "all"}
              onValueChange={(v: string | null) =>
                props.setDistrict(v == null || v === "all" ? "" : v)
              }
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Всички">
                  {props.district
                    ? props.districts.find((d) => String(d.id) === props.district)?.name ?? "—"
                    : "Всички"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всички</SelectItem>
                {props.districts.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[11px] text-muted-foreground">Община</div>
            <Select
              value={props.municipality || "all"}
              onValueChange={(v: string | null) =>
                props.setMunicipality(v == null || v === "all" ? "" : v)
              }
              disabled={!props.district}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Всички">
                  {props.municipality
                    ? props.municipalities.find((m) => String(m.id) === props.municipality)?.name ?? "—"
                    : "Всички"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всички</SelectItem>
                {props.municipalities.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">Секция №</div>
          <input
            type="text"
            value={props.sectionFilter}
            onChange={(e) => props.setSectionFilter(e.target.value)}
            placeholder="напр. 234600001"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground/50"
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Тип секция</div>
          <div className="flex flex-wrap gap-1">
            {SECTION_TYPES.map((t) => {
              const active = props.sectionTypes.has(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => props.toggleSectionType(t.key)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={`border-t border-border ${expanded ? "" : "hidden md:block"}`}
      />

      {/* Section 2: Anomaly analysis */}
      <div
        className={`flex-col gap-2.5 p-3.5 pt-3 ${expanded ? "flex" : "hidden md:flex"}`}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Анализ на аномалии
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            Методология
          </div>
          <div className="flex flex-wrap gap-1">
            {METHODOLOGIES.map((m) => (
              <button
                key={m.key}
                onClick={() => props.setMethodology(m.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  props.methodology === m.key
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={props.onlyAnomalies}
            onChange={(e) => props.setOnlyAnomalies(e.target.checked)}
            className="accent-foreground"
          />
          Само аномалии
        </label>

        {/* Status line */}
        <div className="rounded-md bg-secondary px-2.5 py-1.5 text-center text-xs text-muted-foreground">
          {props.baseLoading || props.riskLoading ? (
            "Зареждане..."
          ) : (
            <>
              <b>{props.riskCountWithCoords}</b> отбелязани
              {!props.onlyAnomalies && (
                <>
                  {" "}от <b>{props.filteredBaseCount.toLocaleString()}</b>
                </>
              )}{" "}
              секции
            </>
          )}
        </div>
      </div>
    </div>
  );
}
