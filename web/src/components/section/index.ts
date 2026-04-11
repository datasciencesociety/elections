/**
 * Shared section-display building blocks. Anything that shows "a polling
 * section" — the anomaly-map sidebar, the sections-table drilldown, the
 * section-detail page, the persistence popover — should compose from this
 * module.
 *
 * High-level (the most common imports):
 *
 *   <SectionView />        location + one election (the canonical "show
 *                          a section" composition; what the sidebar uses)
 *   <SectionLocation />    settlement + address + map + suggest-location
 *   <SectionElection />    one election: links + protocol + ballot +
 *                          (optional) methodology cards
 *
 * Leaves (compose your own when you need a different layout):
 *
 *   <SectionHeader />
 *   <SectionMap />
 *   <SectionLinks />
 *   <SectionProtocolSummary />
 *   <SectionViolations />
 *
 * Hook:
 *
 *   useSectionFull(electionId, sectionCode, { initialAnomaly })
 *     bundles the three queries (detail, violations, anomaly row) used
 *     by every section view.
 *
 * Methodology cards (used inside SectionElection):
 *
 *   ./cards/overall-score-card, turnout-card, binary-flags,
 *   benford-card, peer-card, acf-card
 */

export { SectionView } from "./section-view.js";
export { SectionLocation } from "./section-location.js";
export { SectionElection } from "./section-election.js";

export { SectionHeader } from "./section-header.js";
export { SectionMap } from "./section-map.js";
export { SectionLinks } from "./section-links.js";
export { SectionProtocolSummary } from "./section-protocol-summary.js";
export { SectionViolations } from "./section-violations.js";

export { useSectionFull, type SectionFullData } from "./use-section-full.js";
