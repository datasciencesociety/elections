import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Search, X } from "lucide-react";
import {
  useLocationSearch,
  groupResultsByLocation,
  type LocationSearchResult,
  type SearchGroup,
} from "@/lib/search/location-search.js";

/**
 * Reusable search input with a client-side autocomplete dropdown. Used on
 * the landing page and (optionally) inside the nav bar. All behavior lives
 * here; callers only tune layout via `variant` and optional `placeholder`.
 *
 * Results are section-level but displayed grouped by address — the address
 * is shown once per group as a clickable header, with every matching
 * section inside that address listed as a row below. Clicking the address
 * header opens the first section at that address; clicking a specific
 * section opens that one. This lets someone find their building, then
 * pick their exact section number inside it.
 *
 * `variant="hero"` — the big, centered landing input.
 * `variant="compact"` — nav bar / inline use. Smaller, no hint text.
 */
export default function SearchBox({
  variant = "hero",
  placeholder = "София Младост, Банско, Истанбул...",
  hint = "Търсете по населено място, адрес, район или име на училище.",
}: {
  variant?: "hero" | "compact";
  placeholder?: string;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { results, status } = useLocationSearch(query);
  const groups = groupResultsByLocation(results);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Reset active index when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  const dropdownOpen = focused && query.trim().length > 0;

  function handleSelect(r: LocationSearchResult) {
    setFocused(false);
    setQuery("");
    navigate(`/section/${r.sectionCode}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || results.length === 0) {
      if (e.key === "Escape") {
        (e.target as HTMLInputElement).blur();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[activeIdx];
      if (pick) handleSelect(pick);
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  const isHero = variant === "hero";

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2 rounded-full border border-border bg-card transition-all focus-within:border-foreground/40 focus-within:shadow-md ${
          isHero ? "gap-3 px-5 shadow-sm" : "px-3"
        }`}
      >
        <Search
          size={isHero ? 18 : 15}
          className="shrink-0 text-muted-foreground"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60 ${
            isHero ? "h-12 text-base md:h-14 md:text-lg" : "h-8 text-xs"
          }`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Търсене на избирателна секция"
          aria-autocomplete="list"
          aria-expanded={dropdownOpen}
          aria-controls="search-results"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Изчисти"
          >
            <X size={isHero ? 16 : 13} />
          </button>
        )}
      </div>

      {/* Hint under input (hero only) */}
      {isHero && !dropdownOpen && hint && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {/* Dropdown */}
      {dropdownOpen && (
        <div
          id="search-results"
          role="listbox"
          className="dropdown-panel"
        >
          {status === "loading" && (
            <div className="px-5 py-4 text-sm text-muted-foreground">
              Зареждане на индекса...
            </div>
          )}
          {status === "error" && (
            <div className="px-5 py-4 text-sm text-score-high">
              Грешка при зареждане. Опитайте отново.
            </div>
          )}
          {status === "ready" && results.length === 0 && (
            <div className="px-5 py-4 text-sm text-muted-foreground">
              Няма намерени секции за „{query}".
            </div>
          )}
          {status === "ready" && groups.length > 0 && (
            <GroupedResults
              groups={groups}
              activeIdx={activeIdx}
              onSelect={handleSelect}
              onHover={setActiveIdx}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the ranked section list as visual groups. Address header is
 * clickable (navigates to the first section in the group). Individual
 * section rows inside the group are each selectable via keyboard or click.
 *
 * `activeIdx` indexes into the flat `results[]` that the parent passes into
 * `groupResultsByLocation` — so we count a running offset as we render to
 * decide which row is currently highlighted.
 */
function GroupedResults({
  groups,
  activeIdx,
  onSelect,
  onHover,
}: {
  groups: SearchGroup[];
  activeIdx: number;
  onSelect: (r: LocationSearchResult) => void;
  onHover: (idx: number) => void;
}) {
  let flatIdx = 0;
  return (
    <>
      {groups.map((g) => {
        const groupStart = flatIdx;
        const rows = g.sections.map((s) => {
          const idx = flatIdx++;
          return (
            <SectionRow
              key={s.sectionCode}
              section={s}
              active={idx === activeIdx}
              onClick={() => onSelect(s)}
              onMouseEnter={() => onHover(idx)}
            />
          );
        });
        return (
          <div
            key={g.locationId}
            className="border-b border-border last:border-b-0"
          >
            <AddressHeader
              group={g}
              onClick={() => onSelect(g.sections[0])}
              onMouseEnter={() => onHover(groupStart)}
            />
            <div>{rows}</div>
          </div>
        );
      })}
    </>
  );
}

function AddressHeader({
  group,
  onClick,
  onMouseEnter,
}: {
  group: SearchGroup;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const meta = [
    group.municipality && `община ${group.municipality}`,
    group.district && `област ${group.district}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors hover:bg-secondary/40"
    >
      <div className="flex w-full items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-semibold text-foreground">
          {group.settlement || "—"}
        </div>
        {group.sections.length > 1 && (
          <div className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">
            {group.sections.length} секции
          </div>
        )}
      </div>
      {group.address && (
        <div className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {group.address}
        </div>
      )}
      {meta && (
        <div className="truncate text-xs text-muted-foreground/80">
          {meta}
        </div>
      )}
    </button>
  );
}

function SectionRow({
  section,
  active,
  onClick,
  onMouseEnter,
}: {
  section: LocationSearchResult;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`flex w-full items-center gap-3 border-t border-border/40 px-4 py-1.5 text-left transition-colors ${
        active ? "bg-secondary/70" : "hover:bg-secondary/40"
      }`}
    >
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        Секция
      </span>
      <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
        {section.sectionCode}
      </span>
      <span className="ml-auto text-2xs text-score-high">→</span>
    </button>
  );
}
