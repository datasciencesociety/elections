import { useEffect, useState } from "react";
import { Outlet, NavLink, useParams, useNavigate } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Menu, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useElections } from "@/lib/hooks/use-elections.js";

const NAV_ITEMS = [
  { label: "Резултати", path: "results" },
  { label: "Секции", path: "sections" },
  { label: "Таблица", path: "table" },
] as const;

const STANDALONE_NAV = [
  { label: "Системни", path: "/persistence" },
] as const;

const REPORT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdLB0n9twfFQyiD4mIpAX_fYc_-N5bUhfkKpVJa6_-Oxv5CAQ/viewform";

export default function Layout() {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const { data: elections = [] } = useElections();
  const [menuOpen, setMenuOpen] = useState(false);

  // Redirect to latest election only from root path
  const isRootPath = window.location.pathname === "/";
  useEffect(() => {
    if (isRootPath && elections.length > 0) {
      navigate(`/${elections[0].id}/results`, { replace: true });
    }
  }, [isRootPath, elections, navigate]);

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [electionId]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors ${
      isActive
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex h-screen w-full flex-col">
      {/* Navbar — top bar */}
      <nav className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2 md:h-11 md:px-4 md:py-0">
        {/* App title */}
        <span className="font-display text-lg font-semibold tracking-tight text-foreground">
          Избори
        </span>

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
            <SelectTrigger size="sm" className="min-w-0 flex-1 border-0 bg-transparent text-xs font-medium shadow-none md:flex-none md:max-w-[500px]">
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
                  <span className="ml-1 shrink-0 text-muted-foreground">({e.date})</span>
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

        {/* Desktop help actions */}
        <div className="hidden items-center gap-1 md:ml-auto md:flex">
          <NavLink to="/help/coordinates" className={navLinkClass}>
            Помогни
          </NavLink>
          <a
            href={`${REPORT_FORM_URL}?entry.1736983913=${encodeURIComponent(window.location.href)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-[#ce463c] transition-colors hover:bg-[#ce463c10]"
          >
            Проблем?
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="flex flex-col gap-1 border-b border-border bg-background px-3 py-2 md:hidden">
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
          <div className="my-1 h-px bg-border" />
          <NavLink to="/help/coordinates" onClick={() => setMenuOpen(false)} className={navLinkClass}>
            Помогни
          </NavLink>
          <a
            href={`${REPORT_FORM_URL}?entry.1736983913=${encodeURIComponent(window.location.href)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className="rounded px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-[#ce463c] transition-colors hover:bg-[#ce463c10]"
          >
            Проблем?
          </a>
        </div>
      )}

      {/* Main content */}
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
