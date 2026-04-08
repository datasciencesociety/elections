import { useEffect, useState } from "react";
import { Outlet, NavLink, useParams, useNavigate } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

const NAV_ITEMS = [
  { label: "Резултати", path: "results" },
  { label: "Секции", path: "sections" },
  { label: "Таблица", path: "table" },
] as const;

const STANDALONE_NAV = [
  { label: "Системни", path: "/persistence" },
] as const;

// Hidden for now — not ready for public release
// const STANDALONE_ITEMS = [
//   { label: "Сравнение", path: "/compare" },
//   { label: "Партии", path: "/parties" },
// ] as const;

export default function Layout() {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const [elections, setElections] = useState<Election[]>([]);

  useEffect(() => {
    fetch("/api/elections")
      .then((res) => res.json())
      .then(setElections)
      .catch(() => {});
  }, []);

  // Redirect to latest election only from root path
  const isRootPath = window.location.pathname === "/";
  useEffect(() => {
    if (isRootPath && elections.length > 0) {
      navigate(`/${elections[0].id}/results`, { replace: true });
    }
  }, [isRootPath, elections, navigate]);

  return (
    <div className="flex h-screen w-full flex-col">
      {/* Navbar */}
      <nav className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1.5 md:h-12 md:flex-nowrap md:px-3 md:py-0">
        {/* App title */}
        <span className="text-sm font-bold tracking-tight">Избори</span>

        {/* Election selector */}
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
            <SelectTrigger size="sm" className="min-w-0 max-w-[160px] text-xs sm:max-w-[220px] md:max-w-[320px]">
              <SelectValue placeholder="Избери избори">
                {(() => {
                  const eid = electionId ?? String(elections[0]?.id);
                  const e = elections.find((el) => String(el.id) === eid);
                  return e ? e.name : eid;
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              {elections.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  <span className="truncate">{e.name}</span>
                  <span className="ml-1 shrink-0 text-muted-foreground">({e.date})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Election-scoped nav items */}
        {(electionId || elections.length > 0) && (
          <div className="ml-auto flex items-center gap-0.5 md:ml-0">
            {NAV_ITEMS.map((item) => {
              const eid = electionId ?? String(elections[0]?.id);
              return (
                <NavLink
                  key={item.path}
                  to={`/${eid}/${item.path}`}
                  className={({ isActive }) =>
                    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        )}

        {/* Standalone (non-election-scoped) nav */}
        <div className="ml-auto flex items-center gap-0.5">
          {STANDALONE_NAV.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
