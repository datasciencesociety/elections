import { useEffect, useState } from "react";
import { Outlet, NavLink, Link, useParams, useNavigate, useLocation } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Menu, X } from "lucide-react";
import { ShareButton } from "@/components/ui/share-button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useElections } from "@/lib/hooks/use-elections.js";
import SearchBox from "@/components/search-box.js";


const NAV_ITEMS = [
  { label: "Резултати", path: "results" },
  { label: "Секции", path: "sections" },
  { label: "Таблица", path: "table" },
] as const;

const STANDALONE_NAV = [
  { label: "Системни", path: "/persistence" },
  { label: "Изследвай с AI", path: "/help/explorer" },
] as const;

export default function Layout() {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: elections = [] } = useElections();
  const [menuOpen, setMenuOpen] = useState(false);

  // Pages that carry their own in-page filter (see `section-filters.tsx`).
  // On those pages the in-page filter is the primary tool, and a second
  // search input in the nav bar competes with it visually. The global
  // navigator collapses away here; users who know a section code can still
  // click the brand to go back to the landing page and search from there.
  const isFilterPage =
    /^\/\d+\/(sections|table)$/.test(location.pathname) ||
    location.pathname === "/persistence";

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [electionId, location.pathname]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded px-3 py-1.5 text-sm font-medium uppercase tracking-eyebrow transition-colors ${
      isActive
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex h-screen w-full flex-col">
      {/* Navbar — top bar */}
      <nav className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2 md:h-11 md:px-4 md:py-0">
        {/* Brand — clickable back to landing */}
        <Link
          to="/"
          className="font-display text-xl font-medium tracking-tight text-foreground transition-colors hover:text-score-high"
        >
          Изборен монитор
        </Link>

        {/* Thin vertical divider */}
        <span className="hidden h-4 w-px bg-border md:block" />

        {/* Election selector — wider on mobile */}
        {elections.length > 0 && (
          <Select
            value={electionId ?? String(elections[0]?.id)}
            onValueChange={(val) => {
              const path = window.location.pathname;
              const viewMatch = path.match(/\/\d+\/(\w+)/);
              const view = viewMatch ? viewMatch[1] : "results";
              trackEvent("select_election", { election_id: val });
              navigate(`/${val}/${view}`);
            }}
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1 border-0 bg-transparent text-sm font-medium shadow-none md:flex-none md:max-w-selector">
              <SelectValue placeholder="Избери избори">
                {(() => {
                  const eid = electionId ?? String(elections[0]?.id);
                  const e = elections.find((el) => String(el.id) === eid);
                  return e ? e.name : eid;
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="min-w-[min(400px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
              {elections.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  <span className="truncate">{e.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Desktop nav items */}
        <div className="hidden items-center gap-0.5 md:flex">
          {(electionId || elections.length > 0) && NAV_ITEMS.map((item) => {
            const eid = electionId ?? String(elections[0]?.id);
            return (
              <NavLink key={item.path} to={`/${eid}/${item.path}`} className={navLinkClass}>
                {item.label}
              </NavLink>
            );
          })}
          {STANDALONE_NAV.map((item) => (
            <NavLink key={item.path} to={item.path} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Desktop navigator — single-result search that goes to a section
            page. Hidden on filter pages so the in-page filter is the one
            obvious tool. */}
        {!isFilterPage && (
          <div className="hidden w-full max-w-xs md:ml-auto md:block">
            <SearchBox
              variant="compact"
              placeholder="Намерете секция: адрес, училище..."
            />
          </div>
        )}

        {/* Share button — takes over ml-auto when the nav search is hidden
            so the right cluster still sits on the right edge. */}
        <ShareButton className={isFilterPage ? "md:ml-auto" : ""} />

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile dropdown menu — nav links + search in one drawer so
          the navbar stays compact when nothing is open */}
      {menuOpen && (
        <div className="relative z-30 flex flex-col gap-2 border-b border-border bg-background px-3 py-2 md:hidden">
          <div className="flex flex-col gap-1">
            {(electionId || elections.length > 0) && NAV_ITEMS.map((item) => {
              const eid = electionId ?? String(elections[0]?.id);
              return (
                <NavLink
                  key={item.path}
                  to={`/${eid}/${item.path}`}
                  onClick={() => setMenuOpen(false)}
                  className={navLinkClass}
                >
                  {item.label}
                </NavLink>
              );
            })}
            {STANDALONE_NAV.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                className={navLinkClass}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <SearchBox
            variant="compact"
            placeholder="Намерете секция: адрес, град или училище..."
          />
        </div>
      )}

      {/* Main content */}
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
