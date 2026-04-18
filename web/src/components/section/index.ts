/**
 * Shared section-display building blocks. Anything that shows "a polling
 * section" — the anomaly-map sidebar, the sections-table drilldown, the
 * section-detail page, the persistence popover — composes from this module.
 *
 *   <SectionView />        location + one election (the canonical "show
 *                          a section" composition; what the sidebar uses)
 *   <SectionLocation />    settlement + address + map + suggest-location
 *   <SectionElection />    one election: links + protocol + ballot +
 *                          (optional) methodology cards
 *
 * Leaves (SectionMap, SectionLinks, SectionProtocolSummary, SectionViolations,
 * useSectionFull) are internal composition details — import them directly
 * from their files if you need them.
 */

export { SectionView } from "./section-view.js";
export { SectionLocation } from "./section-location.js";
export { SectionElection } from "./section-election.js";
