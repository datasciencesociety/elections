/** OG image templates — one per page type.
 *
 * Satori uses flexbox-only layout with inline styles. No CSS classes,
 * no grid, no position:absolute. All elements are divs with `display: flex`.
 */

import type { ReactNode } from "react";
import type {
  OgElection,
  OgTopParty,
  OgSectionDetail,
  OgSectionHistoryElection,
  OgSectionElection,
  OgDistrict,
  OgPersistenceSummary,
  OgMunicipality,
} from "./queries.js";

// Brand — light theme
const RED = "#ce463c";
const BG = "#fbfbfb";
const TEXT = "#1a1a1a";
const MUTED = "#666666";
const STAT_BG = "#f0efed";
const BORDER = "#e5e3e0";

// Shared wrapper — white card with red accent line at top
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: BG,
        padding: "0",
      }}
    >
      {/* Red top accent */}
      <div style={{ display: "flex", width: "100%", height: "6px", backgroundColor: RED }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "48px 56px 40px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div
        style={{
          display: "flex",
          width: "12px",
          height: "12px",
          backgroundColor: RED,
          borderRadius: "2px",
        }}
      />
      <span
        style={{
          fontFamily: "Geist",
          fontSize: "18px",
          color: MUTED,
          letterSpacing: "0.05em",
        }}
      >
        ИЗБОРЕН МОНИТОР
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "16px 24px",
        backgroundColor: STAT_BG,
        borderRadius: "8px",
        border: `1px solid ${BORDER}`,
      }}
    >
      <span style={{ fontFamily: "Geist", fontSize: "14px", color: MUTED }}>
        {label}
      </span>
      <span
        style={{ fontFamily: "Geist", fontSize: "32px", fontWeight: 700, color: TEXT }}
      >
        {String(value)}
      </span>
    </div>
  );
}

// ─── Landing page ───

export function LandingTemplate() {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "16px",
        }}
      >
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "64px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          Виж как гласува
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "64px",
            fontWeight: 700,
            color: RED,
            lineHeight: "1.1",
          }}
        >
          твоята секция
        </span>
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "22px",
            color: MUTED,
            marginTop: "12px",
          }}
        >
          Резултати, аномалии и протоколи от изборите в България 2021–2025
        </span>
      </div>
    </Card>
  );
}

// ─── Election results (district pie map) ───

export function ElectionResultsTemplate({
  election,
  parties,
}: {
  election: OgElection;
  parties: OgTopParty[];
}) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Резултати по райони
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "52px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          {election.name}
        </span>
        {/* Party bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
          {parties.slice(0, 5).map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  display: "flex",
                  width: `${Math.max(40, (p.pct / (parties[0]?.pct || 1)) * 400)}px`,
                  height: "28px",
                  backgroundColor: p.color,
                  borderRadius: "4px",
                }}
              />
              <span style={{ fontFamily: "Geist", fontSize: "16px", color: TEXT }}>
                {p.name}
              </span>
              <span style={{ fontFamily: "Geist", fontSize: "16px", color: MUTED }}>
                {p.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Anomaly map / sections table ───

export function AnomalyTemplate({
  election,
  variant,
}: {
  election: OgElection;
  variant: "map" | "table";
}) {
  const subtitle = variant === "map" ? "Карта на аномалиите" : "Таблица на секциите";
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {subtitle}
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "52px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          {election.name}
        </span>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <Stat label="Секции" value={election.total_sections.toLocaleString("bg-BG")} />
          <Stat label="С аномалии" value={election.flagged_sections.toLocaleString("bg-BG")} />
          <Stat
            label="Процент"
            value={
              election.total_sections > 0
                ? `${((election.flagged_sections / election.total_sections) * 100).toFixed(1)}%`
                : "—"
            }
          />
        </div>
      </div>
    </Card>
  );
}

// ─── Section detail (cross-election /section/:code) ───

function riskColorFn(score: number): string {
  if (score >= 0.6) return RED;
  if (score >= 0.3) return "#e8a838";
  return "#22c55e";
}

function ElectionBlock({ e, barWidth }: { e: OgSectionHistoryElection; barWidth: number }) {
  const turnoutPct = (e.turnout_rate * 100).toFixed(e.turnout_rate > 1 ? 1 : 0);
  const isHighTurnout = e.turnout_rate > 1;
  const F = "Geist";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "8px 10px", backgroundColor: "#ffffff", borderRadius: "6px", border: `1px solid ${BORDER}` }}>
      {/* Election name + risk dot */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{ display: "flex", width: "7px", height: "7px", borderRadius: "4px", backgroundColor: riskColorFn(e.risk_score), flexShrink: 0 }} />
        <span style={{ fontFamily: F, fontSize: "11px", fontWeight: 700, color: TEXT }}>{e.election_name}</span>
      </div>
      {/* Stats line: Зап. / Глас. / Акт. / Доп. / Нар. */}
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
        <span style={{ fontFamily: F, fontSize: "10px", color: MUTED }}>Зап. <span style={{ color: TEXT }}>{e.registered_voters}</span></span>
        <span style={{ fontFamily: F, fontSize: "10px", color: MUTED }}>Глас. <span style={{ color: TEXT }}>{e.actual_voters}</span></span>
        <span style={{ fontFamily: F, fontSize: "10px", color: isHighTurnout ? RED : MUTED, fontWeight: isHighTurnout ? 700 : 400 }}>
          Акт. <span style={{ color: isHighTurnout ? RED : TEXT, fontWeight: isHighTurnout ? 700 : 400 }}>{turnoutPct}%</span>
        </span>
        {e.added_voters > 0 && (
          <span style={{ fontFamily: F, fontSize: "10px", color: MUTED }}>Доп. <span style={{ color: TEXT }}>{e.added_voters}</span></span>
        )}
        {e.protocol_violation_count > 0 && (
          <span style={{ fontFamily: F, fontSize: "10px", color: RED, fontWeight: 700 }}>
            {e.protocol_violation_count} нар.
          </span>
        )}
      </div>
      {/* Stacked party bar */}
      {e.parties.length > 0 && (
        <div style={{ display: "flex", height: "10px", borderRadius: "3px", overflow: "hidden", width: `${barWidth}px` }}>
          {e.parties.map((p, i) => (
            <div key={i} style={{ display: "flex", width: `${p.pct}%`, height: "100%", backgroundColor: p.color }} />
          ))}
        </div>
      )}
      {/* Party legend — inline */}
      {e.parties.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
          {e.parties.slice(0, 4).map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
              <div style={{ display: "flex", width: "5px", height: "5px", borderRadius: "3px", backgroundColor: p.color }} />
              <span style={{ fontFamily: F, fontSize: "8px", color: MUTED }}>{p.name} {p.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionDetailTemplate({
  section,
  history,
}: {
  section: OgSectionDetail;
  history: OgSectionHistoryElection[];
}) {
  // Layout: 2 columns of election blocks, most recent first
  const half = Math.ceil(history.length / 2);
  const col1 = history.slice(0, half);
  const col2 = history.slice(half);
  const BAR_W = 480;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Logo />
        <span style={{ fontFamily: "Geist", fontSize: "16px", color: MUTED }}>karta.izborenmonitor.com</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "8px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ fontFamily: "EB Garamond", fontSize: "32px", fontWeight: 700, color: TEXT, lineHeight: "1.1" }}>
              Секция {section.section_code}
            </span>
            {section.settlement_name && (
              <span style={{ fontFamily: "Geist", fontSize: "13px", color: MUTED }}>
                {section.settlement_name}{section.address ? ` — ${section.address}` : ""}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "14px", alignItems: "baseline" }}>
            <span style={{ fontFamily: "Geist", fontSize: "12px", color: MUTED }}>
              {section.elections_flagged}/{section.elections_present} с аномалии
            </span>
            <span style={{ fontFamily: "Geist", fontSize: "12px", color: section.total_violations > 0 ? RED : MUTED }}>
              {section.total_violations} нарушения
            </span>
          </div>
        </div>
        {/* Two columns of election blocks */}
        <div style={{ display: "flex", gap: "8px", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "4px" }}>
            {col1.map((e, i) => <ElectionBlock key={i} e={e} barWidth={BAR_W} />)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "4px" }}>
            {col2.map((e, i) => <ElectionBlock key={i} e={e} barWidth={BAR_W} />)}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Persistence ───

export function PersistenceTemplate({
  summary,
}: {
  summary: OgPersistenceSummary;
}) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Системни сигнали
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "52px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          Повтарящи се аномалии
        </span>
        <span style={{ fontFamily: "Geist", fontSize: "22px", color: MUTED }}>
          Секции с аномалии в поне 2 избора
        </span>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <Stat label="Общо секции" value={summary.total_sections.toLocaleString("bg-BG")} />
          <Stat label="Системни" value={summary.total_persistent.toLocaleString("bg-BG")} />
        </div>
      </div>
    </Card>
  );
}

// ─── Contextual results (municipality selected) ───

export function ResultsContextTemplate({
  election,
  municipality,
  parties,
  highlightParty,
  mapDataUri,
}: {
  election: OgElection;
  municipality: OgMunicipality | null;
  parties: OgTopParty[];
  highlightParty?: string | null;
  mapDataUri?: string | null;
}) {
  const scope = municipality ? municipality.name : "Национални резултати";
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Logo />
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "16px",
            color: MUTED,
          }}
        >
          karta.izborenmonitor.com
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: "32px",
          alignItems: "center",
        }}
      >
        {/* Left: map */}
        {mapDataUri && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "480px",
              flexShrink: 0,
            }}
          >
            <img
              src={mapDataUri}
              width={460}
              height={280}
              style={{ objectFit: "contain" }}
            />
          </div>
        )}
        {/* Right: text + bars */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span
              style={{
                fontFamily: "Geist",
                fontSize: "16px",
                color: MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {scope}
            </span>
            <span
              style={{
                fontFamily: "EB Garamond",
                fontSize: "36px",
                fontWeight: 700,
                color: TEXT,
                lineHeight: "1.15",
              }}
            >
              {election.name}
            </span>
          </div>
          {/* Party bars — scale to the largest entry (often non-voters) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {parties.map((p) => {
              const isHighlighted = highlightParty && p.name.toLowerCase() === highlightParty.toLowerCase();
              const maxPct = Math.max(...parties.map((pp) => pp.pct), 1);
              const maxBar = mapDataUri ? 220 : 360;
              const barWidth = Math.max(24, (p.pct / maxPct) * maxBar);
              return (
                <div
                  key={p.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    opacity: highlightParty && !isHighlighted ? 0.2 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: `${barWidth}px`,
                      height: "22px",
                      backgroundColor: p.color,
                      borderRadius: "3px",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "Geist",
                      fontSize: "13px",
                      fontWeight: isHighlighted ? 700 : 400,
                      color: TEXT,
                    }}
                  >
                    {p.name}
                  </span>
                  <span style={{ fontFamily: "Geist", fontSize: "13px", color: MUTED }}>
                    {p.pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Section in election (/:electionId/sections or /table share) ───

export function SectionElectionTemplate({
  election,
  section,
}: {
  election: OgElection;
  section: OgSectionElection;
}) {
  const topParties = section.parties.slice(0, 7);
  const maxVotes = topParties[0]?.pct || 1;
  const hasViolations = section.protocol_violation_count > 0;
  const hasRisk = section.risk_score >= 0.3;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Logo />
        <span style={{ fontFamily: "Geist", fontSize: "16px", color: MUTED }}>
          karta.izborenmonitor.com
        </span>
      </div>
      <div style={{ display: "flex", flex: 1, gap: "40px", alignItems: "stretch" }}>
        {/* Left column: section info + party bars */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: "14px" }}>
          {/* Section header */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontFamily: "Geist", fontSize: "14px", color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {election.name}
            </span>
            <span style={{ fontFamily: "EB Garamond", fontSize: "42px", fontWeight: 700, color: TEXT, lineHeight: "1.1" }}>
              Секция {section.section_code}
            </span>
            {section.settlement_name && (
              <span style={{ fontFamily: "Geist", fontSize: "16px", color: MUTED }}>
                {section.settlement_name}
                {section.address ? ` — ${section.address}` : ""}
              </span>
            )}
          </div>
          {/* Party results */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {topParties.map((p) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "flex", width: `${Math.max(20, (p.pct / maxVotes) * 280)}px`, height: "18px", backgroundColor: p.color, borderRadius: "3px" }} />
                <span style={{ fontFamily: "Geist", fontSize: "12px", color: TEXT }}>{p.name}</span>
                <span style={{ fontFamily: "Geist", fontSize: "12px", color: MUTED }}>{p.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        {/* Right column: protocol stats */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "12px", width: "320px", flexShrink: 0 }}>
          {/* Turnout block */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px 20px", backgroundColor: STAT_BG, borderRadius: "10px", border: `1px solid ${BORDER}` }}>
            <span style={{ fontFamily: "Geist", fontSize: "13px", color: MUTED }}>Активност</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontFamily: "Geist", fontSize: "36px", fontWeight: 700, color: TEXT }}>{section.turnout_pct}%</span>
              <span style={{ fontFamily: "Geist", fontSize: "14px", color: MUTED }}>
                {section.actual_voters} от {section.registered_voters}
              </span>
            </div>
            {(section.invalid_votes > 0 || section.null_votes > 0) && (
              <span style={{ fontFamily: "Geist", fontSize: "12px", color: MUTED }}>
                {section.invalid_votes > 0 ? `${section.invalid_votes} невалидни` : ""}
                {section.invalid_votes > 0 && section.null_votes > 0 ? " · " : ""}
                {section.null_votes > 0 ? `${section.null_votes} не подкрепям никого` : ""}
              </span>
            )}
          </div>
          {/* Risk + violations row */}
          <div style={{ display: "flex", gap: "10px" }}>
            {/* Risk score */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "14px 18px", backgroundColor: STAT_BG, borderRadius: "10px", border: `1px solid ${BORDER}`, flex: 1 }}>
              <span style={{ fontFamily: "Geist", fontSize: "13px", color: MUTED }}>Аномалия</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "flex", width: "10px", height: "10px", borderRadius: "5px", backgroundColor: riskColorFn(section.risk_score) }} />
                <span style={{ fontFamily: "Geist", fontSize: "28px", fontWeight: 700, color: hasRisk ? riskColorFn(section.risk_score) : TEXT }}>
                  {section.risk_score.toFixed(2)}
                </span>
              </div>
            </div>
            {/* Violations */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "14px 18px", backgroundColor: hasViolations ? "#fef2f2" : STAT_BG, borderRadius: "10px", border: `1px solid ${hasViolations ? "#fecaca" : BORDER}`, flex: 1 }}>
              <span style={{ fontFamily: "Geist", fontSize: "13px", color: MUTED }}>Нарушения</span>
              <span style={{ fontFamily: "Geist", fontSize: "28px", fontWeight: 700, color: hasViolations ? RED : TEXT }}>
                {section.protocol_violation_count}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Browse district ───

export function DistrictTemplate({ district }: { district: OgDistrict }) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Район
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "56px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          {district.name}
        </span>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <Stat label="Общини" value={district.municipality_count} />
          <Stat label="Секции" value={district.section_count.toLocaleString("bg-BG")} />
        </div>
      </div>
    </Card>
  );
}
