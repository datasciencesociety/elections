import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { LiveSection } from "@/lib/api/live-sections.js";

/**
 * Autocomplete for polling-section codes and addresses. Candidates are the
 * flattened CIK list (~12k rows, already in memory via React Query), so we
 * match client-side with a normalized substring check: lowercase, strip
 * punctuation, tokenize, every token must hit either `address` or
 * `section_code`.
 *
 * This is intentionally separate from the app's main `section-search-input`,
 * which queries the API and is scoped to our analytical universe. The
 * election-day `/live` page should also find polling places that aren't in
 * our DB yet (abroad, newly added) — so the source of truth here is the
 * CIK JSON.
 */
export function LiveSearch({
  sections,
  onPick,
  placeholder = "Търсене на секция: адрес, училище, номер...",
}: {
  sections: LiveSection[];
  onPick: (section: LiveSection) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const results = useMemo(() => {
    const q = normalize(query);
    if (q.length < 2) return [] as LiveSection[];
    const tokens = q.split(/\s+/).filter(Boolean);
    const out: LiveSection[] = [];
    for (const s of sections) {
      const haystack = `${s.section_code} ${normalize(s.address)}`;
      if (tokens.every((t) => haystack.includes(t))) {
        out.push(s);
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [sections, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  function pick(section: LiveSection) {
    onPick(section);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIdx];
      if (hit) pick(hit);
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  const dropdownOpen = focused && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background/95 px-3 shadow-sm backdrop-blur focus-within:border-foreground/40">
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={dropdownOpen}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Изчисти"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {dropdownOpen && (
        <div className="dropdown-panel">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Няма намерени секции.
            </div>
          ) : (
            results.map((s, idx) => (
              <button
                key={s.section_code}
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onClick={() => pick(s)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border/40 px-3 py-2 text-left last:border-b-0 ${
                  idx === activeIdx ? "bg-secondary/70" : "hover:bg-secondary/40"
                }`}
              >
                <div className="flex w-full items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                    {s.section_code}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {s.address}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,\-/"'№()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
