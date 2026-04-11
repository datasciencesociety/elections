import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  useLocationSearch,
  groupResultsByLocation,
  type LocationSearchResult,
  type SearchGroup,
} from "@/lib/search/location-search.js";

/**
 * Section filter input for the tables (anomaly table + persistence). Shares
 * the same grouped-by-address autocomplete with the header `SearchBox`, but
 * instead of navigating to `/section/{code}` on pick, it calls `onPick` so
 * the parent can set a URL param and scope its table.
 *
 * The input's visible text decouples from the upstream filter: the user
 * types → they see autocomplete. When they pick a section the input shows
 * the section code; when they clear it the parent's filter clears too.
 *
 * Address header click → first section in the group (same rule as the
 * header search box). Individual section click → that exact section.
 */
export default function SectionSearchInput({
  value,
  onPick,
  placeholder = "Секция или адрес...",
  className,
}: {
  /** Current value of the upstream filter. Shown as the "pinned" text. */
  value: string;
  onPick: (sectionCode: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // If the parent clears the filter externally (e.g. user hits "reset"),
  // clear our local query too so the input stops showing stale text.
  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);

  const { results, status } = useLocationSearch(query);
  const groups = groupResultsByLocation(results);

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

  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  const dropdownOpen = focused && query.trim().length > 0;

  function handleSelect(r: LocationSearchResult) {
    setFocused(false);
    setQuery(r.sectionCode);
    onPick(r.sectionCode);
    inputRef.current?.blur();
  }

  function handleClear() {
    setQuery("");
    onPick("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || results.length === 0) {
      if (e.key === "Escape") {
        (e.target as HTMLInputElement).blur();
      }
      if (e.key === "Enter" && /^\d+$/.test(query.trim())) {
        // Raw digit filter — apply as substring match.
        e.preventDefault();
        onPick(query.trim());
        setFocused(false);
        inputRef.current?.blur();
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

  // When the input isn't focused and the parent has a pinned value, show
  // the pinned section code as the displayed text.
  const displayValue = focused ? query : (value || query);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 transition-colors focus-within:border-foreground/40">
        <Search size={12} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            // Also clear the upstream filter as soon as the user starts
            // editing — the dropdown will replace it on pick.
            if (value) onPick("");
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Търсене на секция по адрес или номер"
          aria-autocomplete="list"
          aria-expanded={dropdownOpen}
        />
        {(query || value) && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Изчисти"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {dropdownOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 max-h-[min(60vh,24rem)] min-w-[18rem] overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {status === "loading" && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Зареждане...
            </div>
          )}
          {status === "error" && (
            <div className="px-4 py-3 text-xs text-[#ce463c]">
              Грешка при зареждане.
            </div>
          )}
          {status === "ready" && results.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Няма намерени секции.
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
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-secondary/40"
    >
      <div className="flex w-full items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-semibold text-foreground">
          {group.settlement || "—"}
        </div>
        {group.sections.length > 1 && (
          <div className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
            {group.sections.length} секции
          </div>
        )}
      </div>
      {group.address && (
        <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {group.address}
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
      className={`flex w-full items-center gap-2 border-t border-border/40 px-4 py-1 text-left transition-colors ${
        active ? "bg-secondary/70" : "hover:bg-secondary/40"
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Секция
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-foreground">
        {section.sectionCode}
      </span>
      <span className="ml-auto text-[10px] text-[#ce463c]">избери →</span>
    </button>
  );
}
