import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Search, X } from "lucide-react";
import {
  useLocationSearch,
  type LocationSearchResult,
} from "@/lib/search/location-search.js";

/**
 * Reusable search input with a client-side autocomplete dropdown. Used on
 * the landing page and (optionally) inside the nav bar. All behavior lives
 * here; callers only tune layout via `variant` and optional `placeholder`.
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
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border border-border bg-card shadow-lg"
        >
          {status === "loading" && (
            <div className="px-5 py-4 text-sm text-muted-foreground">
              Зареждане на индекса...
            </div>
          )}
          {status === "error" && (
            <div className="px-5 py-4 text-sm text-[#ce463c]">
              Грешка при зареждане. Опитайте отново.
            </div>
          )}
          {status === "ready" && results.length === 0 && (
            <div className="px-5 py-4 text-sm text-muted-foreground">
              Няма намерени секции за „{query}".
            </div>
          )}
          {status === "ready" &&
            results.map((r, i) => (
              <SearchResultRow
                key={r.id}
                result={r}
                active={i === activeIdx}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIdx(i)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function SearchResultRow({
  result,
  active,
  onClick,
  onMouseEnter,
}: {
  result: LocationSearchResult;
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
      className={`flex w-full items-start gap-3 border-b border-border px-5 py-3 text-left transition-colors last:border-b-0 ${
        active ? "bg-secondary/60" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {result.settlement || "—"}
        </div>
        {result.address && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {result.address}
          </div>
        )}
        {(result.municipality || result.district) && (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
            {[
              result.municipality && `община ${result.municipality}`,
              result.district && `област ${result.district}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
      <div className="shrink-0 pt-0.5 text-right text-[11px] tabular-nums">
        {result.sectionCount === 1 ? (
          <span className="text-muted-foreground">1 секция</span>
        ) : (
          <span className="font-medium text-[#ce463c]">
            виж {result.sectionCount} секции →
          </span>
        )}
      </div>
    </button>
  );
}
