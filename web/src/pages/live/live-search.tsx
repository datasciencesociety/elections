import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { LiveAddress } from "@/lib/api/live-sections.js";

/**
 * Autocomplete for polling addresses. Matches lowercase-normalized tokens
 * against the address string and the section codes that share it, so a
 * viewer can type "елен" → "ЖК ЕЛЕНОВО" or "010300084" → the specific
 * school that hosts that section. One match per address, no duplicates.
 */
export function LiveSearch({
  addresses,
  onPick,
  placeholder = "Търсене: адрес, училище, номер на секция...",
}: {
  addresses: LiveAddress[];
  onPick: (address: LiveAddress) => void;
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
    if (q.length < 2) return [] as LiveAddress[];
    const tokens = q.split(/\s+/).filter(Boolean);
    const out: LiveAddress[] = [];
    for (const a of addresses) {
      const haystack = `${a.section_codes.join(" ")} ${normalize(a.address)}`;
      if (tokens.every((t) => haystack.includes(t))) {
        out.push(a);
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [addresses, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  function pick(a: LiveAddress) {
    onPick(a);
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
            results.map((a, idx) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onClick={() => pick(a)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border/40 px-3 py-2 text-left last:border-b-0 ${
                  idx === activeIdx ? "bg-secondary/70" : "hover:bg-secondary/40"
                }`}
              >
                <div className="flex w-full items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                    {a.section_codes[0]}
                    {a.section_codes.length > 1 && (
                      <span className="ml-1 text-3xs font-medium text-muted-foreground">
                        +{a.section_codes.length - 1}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {a.address}
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
