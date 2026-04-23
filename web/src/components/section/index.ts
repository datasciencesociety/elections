/**
 * Shared section-display building blocks. Anything that shows "a polling
 * section" — the anomaly-map sidebar, the sections-table drilldown, the
 * section-detail page — composes from this module.
 *
 *   <SectionView />        canonical sidebar drilldown: location on top +
 *                          full SectionElection (links, protocol, ballot,
 *                          violations, methodology cards with Benford /
 *                          peer / ACF explanations). Used by the anomaly
 *                          map sidebar and the sections-table sidebar so
 *                          the user sees the "why this section is flagged"
 *                          detail right in the drill-down.
 *   <SectionLocation />    settlement + address + map + suggest-location
 *   <SectionElection />    one election: links + protocol + ballot +
 *                          (optional) methodology cards
 *
 * The dossier page (`pages/section-detail.tsx`) is where heavy content
 * lives; this module's components stay focused.
 */

export { SectionView } from "./section-view.js";
export { SectionLocation } from "./section-location.js";
export { SectionElection } from "./section-election.js";
