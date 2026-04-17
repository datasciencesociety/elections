import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import AppFooter from "@/components/app-footer.js";
import {
  useAbroadBrowse,
  useDistrictBrowse,
} from "@/lib/hooks/use-geography.js";

/**
 * Browse pages — the hierarchical drill-down path into the data.
 *
 * Two variants, both rendered by this file via the React Router `scope`
 * param:
 *
 *   /browse/district/:id  →  <Browse /> with scope="district"
 *   /browse/abroad        →  <Browse /> with scope="abroad"
 *
 * Shape: a header with title + back link, a client-side filter input to
 * narrow long lists, then a list grouped by the natural parent key
 * (municipality for district; country for abroad). Each row is a location
 * with settlement, address, section count, linked to /section/{code}.
 *
 * This is the mom-test fix: every screen is a clickable list with a frame
 * that tells you where you are. No search box on landing required.
 */
export function BrowseDistrict() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const electionId = searchParams.get("election") ?? undefined;
  const { data, isLoading, isError } = useDistrictBrowse(id, electionId);
  const [filter, setFilter] = useState("");

  const normalized = normalize(filter);
  const filtered = useMemo(() => {
    if (!data) return null;
    if (!normalized) return data.locations;
    return data.locations.filter((l) =>
      normalize(
        `${l.municipality_name ?? ""} ${l.settlement_name ?? ""} ${l.address ?? ""}`,
      ).includes(normalized),
    );
  }, [data, normalized]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    return groupBy(filtered, (l) => l.municipality_name ?? "—");
  }, [filtered]);

  return (
    <BrowseShell
      title={data?.district.name ?? "Област"}
      subtitle={
        data
          ? `${data.locations.length.toLocaleString("bg-BG")} места в областта`
          : undefined
      }
      isLoading={isLoading}
      isError={isError}
      filter={filter}
      onFilterChange={setFilter}
      emptyLabel="Няма резултати за този филтър."
      groupCount={grouped?.size ?? 0}
    >
      {grouped &&
        Array.from(grouped.entries()).map(([municipality, locs]) => (
          <BrowseGroup
            key={municipality}
            title={municipality}
            count={locs.length}
            forceOpen={!!normalized}
          >
            {locs.map((l) => (
              <BrowseRow
                key={l.location_id}
                primary={l.settlement_name ?? "—"}
                secondary={l.address ?? ""}
                sectionCodes={l.section_codes}
              />
            ))}
          </BrowseGroup>
        ))}
    </BrowseShell>
  );
}

export function BrowseAbroad() {
  const [searchParams] = useSearchParams();
  const electionId = searchParams.get("election") ?? undefined;
  const { data, isLoading, isError } = useAbroadBrowse(electionId);
  const [filter, setFilter] = useState("");

  const normalized = normalize(filter);
  const filtered = useMemo(() => {
    if (!data) return null;
    if (!normalized) return data.locations;
    return data.locations.filter((l) =>
      normalize(`${l.country} ${l.city} ${l.address ?? ""}`).includes(
        normalized,
      ),
    );
  }, [data, normalized]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    return groupBy(filtered, (l) => l.country || "—");
  }, [filtered]);

  return (
    <BrowseShell
      title="Секции в чужбина"
      subtitle={
        data
          ? `${data.locations.length.toLocaleString("bg-BG")} места в ${(grouped?.size ?? 0).toLocaleString("bg-BG")} държави`
          : undefined
      }
      isLoading={isLoading}
      isError={isError}
      filter={filter}
      onFilterChange={setFilter}
      filterPlaceholder="Напр. Турция, Лондон, Бодо..."
      emptyLabel="Няма резултати за този филтър."
      groupCount={grouped?.size ?? 0}
    >
      {grouped &&
        Array.from(grouped.entries()).map(([country, locs]) => (
          <BrowseGroup
            key={country}
            title={country}
            count={locs.length}
            forceOpen={!!normalized}
          >
            {locs.map((l) => (
              <BrowseRow
                key={l.location_id}
                primary={l.city || l.settlement_name || "—"}
                secondary={l.address ?? ""}
                sectionCodes={l.section_codes}
              />
            ))}
          </BrowseGroup>
        ))}
    </BrowseShell>
  );
}

// ---------- shared shell ----------

function BrowseShell({
  title,
  subtitle,
  isLoading,
  isError,
  filter,
  onFilterChange,
  filterPlaceholder = "Филтър по име...",
  emptyLabel,
  groupCount,
  children,
}: {
  title: string;
  subtitle?: string;
  isLoading: boolean;
  isError: boolean;
  filter: string;
  onFilterChange: (v: string) => void;
  filterPlaceholder?: string;
  emptyLabel: string;
  groupCount: number;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-8 md:py-10">
        {/* Breadcrumb + heading */}
        <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Link to="/" className="transition-colors hover:text-foreground">
            Начало
          </Link>
          <ChevronRight size={11} />
          <span>{title}</span>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
        <div className="mt-3 red-bar" />

        {/* Filter input */}
        <div className="mt-6 mb-6">
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={filterPlaceholder}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-foreground/40"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Зареждане...</p>
        )}
        {isError && (
          <p className="text-sm text-score-high">Грешка при зареждане.</p>
        )}
        {!isLoading && !isError && groupCount === 0 && (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )}

        <div className="space-y-6">{children}</div>
      </div>
      <AppFooter />
    </div>
  );
}

function BrowseGroup({
  title,
  count,
  forceOpen,
  children,
}: {
  title: string;
  count: number;
  /** Force the accordion open — used when the filter input is non-empty so results aren't hidden. */
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={forceOpen || undefined}
      className="group overflow-hidden rounded-md border border-border bg-card"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary/40 [&::-webkit-details-marker]:hidden">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-base font-semibold tracking-tight md:text-lg">
            {title}
          </h2>
          <span className="text-2xs tabular-nums text-muted-foreground">
            {count.toLocaleString("bg-BG")}{" "}
            {count === 1 ? "място" : "места"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
          ▼
        </span>
      </summary>
      <div className="divide-y divide-border border-t border-border">
        {children}
      </div>
    </details>
  );
}

function BrowseRow({
  primary,
  secondary,
  sectionCodes,
}: {
  primary: string;
  secondary: string;
  sectionCodes: string;
}) {
  const codes = sectionCodes.split(",").sort();
  return (
    <div className="px-4 py-3">
      <div className="text-sm font-medium text-foreground">
        {primary}
      </div>
      {secondary && (
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {secondary}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {codes.map((code) => (
          <Link
            key={code}
            to={`/section/${code}`}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-xs tabular-nums transition-colors hover:border-brand hover:text-score-high"
          >
            {code}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------- helpers ----------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}
