import { useLocation } from "react-router";

/**
 * Compact footer strip that sits at the bottom of every page (via Layout).
 *
 * Contains the cross-page links that used to live in multiple places:
 * community Slack, the report-discrepancy form, GRAO, open source. The
 * "Разминаване?" link was previously in the nav bar top-right; it now
 * lives here alongside the rest of the community/contributor links.
 *
 * The report link prefills the Google Form with the current page URL via
 * `useLocation`, so a user reporting an issue on /persistence sends the
 * form with that URL attached automatically.
 */

const SLACK_URL =
  "https://join.slack.com/t/datasc/shared_invite/zt-1g09xs5j9-qtwPQnMhRiFKXGLw3LNI6Q";
const REPORT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdLB0n9twfFQyiD4mIpAX_fYc_-N5bUhfkKpVJa6_-Oxv5CAQ/viewform";
const GRAO_URL =
  "https://www.grao.bg/elections/Secure/Public/EgnSearch.cshtml";
const GITHUB_URL = "https://github.com/georgialexandrov/bg-elections-data";

export default function AppFooter() {
  const location = useLocation();
  const currentUrl =
    typeof window !== "undefined"
      ? window.location.origin + location.pathname + location.search
      : "";
  const reportUrl = `${REPORT_FORM_URL}?entry.1736983913=${encodeURIComponent(currentUrl)}`;

  return (
    <footer className="shrink-0 border-t border-border bg-background px-3 py-1.5 md:px-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="font-display text-xs font-semibold text-foreground">
          Изборен монитор
        </span>
        <span className="hidden text-muted-foreground/40 md:inline">·</span>
        <a
          href={SLACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground"
        >
          Присъединете се в Slack (#izborenmonitor) →
        </a>
        <a
          href={reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#ce463c] transition-colors hover:underline"
        >
          Докладвай разминаване →
        </a>
        <a
          href={GRAO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground"
        >
          Проверете секцията си (ГРАО) →
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground"
        >
          Отворен код →
        </a>
      </div>
    </footer>
  );
}
