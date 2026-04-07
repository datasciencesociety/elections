import { useEffect, useState } from "react";
import { Outlet, NavLink, useParams, useNavigate } from "react-router";

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

const STANDALONE_ITEMS = [
  { label: "Сравнение", path: "/compare" },
  { label: "Партии", path: "/parties" },
] as const;

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

  const currentElection = elections.find((e) => String(e.id) === electionId);

  return (
    <div className="flex h-screen w-full flex-col">
      {/* Navbar */}
      <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-3">
        {/* App title */}
        <span className="mr-3 text-sm font-bold tracking-tight">Избори</span>

        {/* Election selector */}
        {elections.length > 0 && (
          <select
            value={electionId ?? ""}
            onChange={(e) => {
              const newId = e.target.value;
              // Keep current view path when switching elections
              const path = window.location.pathname;
              const viewMatch = path.match(/\/\d+\/(\w+)/);
              const view = viewMatch ? viewMatch[1] : "results";
              navigate(`/${newId}/${view}`);
            }}
            className="mr-4 h-7 cursor-pointer rounded-md border border-border bg-secondary px-2 text-xs font-medium"
          >
            {elections.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name} ({e.date})
              </option>
            ))}
          </select>
        )}

        {/* Divider */}
        <div className="mx-1 h-5 w-px bg-border" />

        {/* Election-scoped nav items */}
        {(electionId || elections.length > 0) && (
          <div className="flex items-center gap-0.5">
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

        {/* Divider */}
        <div className="mx-1 h-5 w-px bg-border" />

        {/* Standalone nav items */}
        <div className="flex items-center gap-0.5">
          {STANDALONE_ITEMS.map((item) => (
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

        {/* Election info — right side */}
        {currentElection && (
          <span className="ml-auto text-xs text-muted-foreground">
            {currentElection.date}
          </span>
        )}
      </nav>

      {/* Main content */}
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
