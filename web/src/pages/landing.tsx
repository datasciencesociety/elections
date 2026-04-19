import { Link } from "react-router";
import { Globe, Video } from "lucide-react";
import { useElections } from "@/lib/hooks/use-elections.js";
import AppFooter from "@/components/app-footer.js";
import {
  useAbroadSummary,
  useDistricts,
} from "@/lib/hooks/use-geography.js";


/**
 * Landing page.
 *
 * Two paths to a section, in priority order:
 *   1. Click a district (or the "Чужбина" tile) and drill down — primary
 *      action for users who prefer to browse, including non-searchers who
 *      don't know what to type into a search box.
 *   2. Type in the search box — secondary action for users who already
 *      know which section they want.
 *
 * Below the fold: explainer, analyst doors, help-us-map card, humble-frame
 * footer. The Layout nav bar is always present (including here) — the
 * "Изборен монитор" brand in the top-left is the clickable home anchor.
 */
export default function Landing() {
  const { data: elections = [] } = useElections();
  const latestId = elections[0]?.id;

  const { data: districts = [] } = useDistricts();
  const { data: abroad } = useAbroadSummary();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-12">
        {/* Tagline — small, the brand lives in the nav */}
        <section className="mb-8 md:mb-10">
          <h1 className="font-display text-2xl font-medium leading-tight tracking-tight md:text-3xl">
            Вижте как се гласува във{" "}
            <span className="brand-underline">Вашата</span> секция.
          </h1>
          <p className="mt-4 max-w-2xl text-md text-muted-foreground">
            Официалните данни на ЦИК, лесни за справка. Изберете област
            или потърсете секция.{" "}
            <a
              href="https://www.grao.bg/elections/Secure/Public/EgnSearch.cshtml"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2 transition-colors hover:text-score-high"
            >
              Проверете коя е Вашата секция
            </a>
            .
          </p>
          <a
            href="#about"
            className="mt-4 inline-block text-xs font-medium uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground"
          >
            Какво е Изборен монитор ↓
          </a>
        </section>

        {/* Election-day live cameras — temporary tile, shown while voting
            is open. Remove or date-gate after 2026-04-19. */}
        <section className="mb-8">
          <Link
            to="/live"
            className="group flex items-start gap-3 rounded-md border border-border bg-card p-4 transition-all hover:border-foreground/30 hover:shadow-sm"
          >
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-score-high/10 text-score-high">
              <Video size={16} />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-2">
                <span className="text-md font-medium text-foreground group-hover:text-score-high">
                  Избори на живо — камерите в секциите
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-score-high/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-eyebrow text-score-high">
                  <span className="size-1 rounded-full bg-score-high" />
                  днес
                </span>
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Открийте Вашата секция на картата и вижте стрийма от ЦИК.
                Автоматичен индикатор „работи / покрита / тъмна“.
              </span>
            </span>
            <span className="mt-1 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
              →
            </span>
          </Link>
        </section>

        {/* Primary: district grid */}
        <section className="mb-10">
          <h2 className="mb-3 eyebrow">
            Изберете област
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {districts.map((d) => (
              <Link
                key={d.id}
                to={latestId ? `/browse/district/${d.id}?election=${latestId}` : `/browse/district/${d.id}`}
                className="group flex flex-col rounded-md border border-border bg-card px-3 py-2 transition-all hover:border-foreground/30 hover:shadow-sm"
              >
                <span className="text-base font-medium text-foreground group-hover:text-score-high">
                  {d.name}
                </span>
                <span className="mt-0.5 text-2xs font-medium uppercase tracking-eyebrow tabular-nums text-muted-foreground">
                  {d.section_count.toLocaleString("bg-BG")} секции
                </span>
              </Link>
            ))}
            <Link
              to={latestId ? `/browse/abroad?election=${latestId}` : "/browse/abroad"}
              className="group flex flex-col rounded-md border border-border bg-secondary/40 px-3 py-2 transition-all hover:border-foreground/30 hover:shadow-sm"
            >
              <span className="flex items-center gap-1.5 text-base font-medium text-foreground group-hover:text-score-high">
                <Globe size={14} className="shrink-0" />
                Чужбина
              </span>
              <span className="mt-0.5 text-2xs font-medium uppercase tracking-eyebrow tabular-nums text-muted-foreground">
                {abroad
                  ? `${abroad.section_count.toLocaleString("bg-BG")} секции · ${abroad.country_count} държави`
                  : "—"}
              </span>
            </Link>
          </div>
        </section>

        {/* Analyst doors */}
        <section className="mb-12">
          <h3 className="mb-3 eyebrow">
            За аналитици
          </h3>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            <DoorRow
              to={latestId ? `/${latestId}/results` : "#"}
              title="Резултати на картата"
              description="Как гласуваха районите и общините. Цветово разпределение по избори."
              disabled={!latestId}
            />
            <DoorRow
              to={latestId ? `/${latestId}/sections` : "#"}
              title="Всички секции на картата"
              description="Около 12 000 секции, оцветени по резултат. Кликнете на секция, за да видите протокола."
              disabled={!latestId}
            />
            <DoorRow
              to={latestId ? `/${latestId}/table` : "#"}
              title="Таблица за анализатори"
              description="Сортируема таблица с всички статистически сигнали: Benford, peer deviation, ACF, протоколни несъответствия."
              disabled={!latestId}
            />
            <DoorRow
              to="/persistence"
              title="Системни сигнали във времето"
              description="Секции, в които статистически сигнали се появяват в множество избори подред."
            />
          </div>
        </section>

        {/* Humble frame — doubles as the #about scroll target. The link
            strip used to live here but moved to the global AppFooter. */}
        <section id="about" className="scroll-mt-24 border-t border-border pt-8 pb-4">
          <h2 className="mb-4 font-display text-xl font-medium tracking-tight">
            Какво е Изборен монитор
          </h2>
          <p className="max-w-prose text-md text-muted-foreground">
            Изборен монитор събира официалните резултати от всички национални
            избори в България от 2021 г. насам и ги свързва с оригиналните
            сканирани протоколи, публикувани от{" "}
            <span className="text-foreground">
              Централната избирателна комисия (ЦИК)
            </span>
            . Построен е от доброволци в свободното им време. Координатите
            на секциите са автоматично установени през Google Maps и
            постепенно се коригират от доброволци.
          </p>
        </section>
      </div>
      <AppFooter />
    </div>
  );
}

function DoorRow({
  to,
  title,
  description,
  disabled,
}: {
  to: string;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const inner = (
    <div className="flex items-center gap-4 px-4 py-4 md:px-6 md:py-5">
      <div className="flex-1">
        <div className="text-md font-medium text-foreground">
          {title}
        </div>
        <div className="mt-2 text-base text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
        →
      </div>
    </div>
  );

  if (disabled) {
    return (
      <div aria-disabled="true" className="group block opacity-50">
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className="group block transition-colors hover:bg-secondary/40"
    >
      {inner}
    </Link>
  );
}
