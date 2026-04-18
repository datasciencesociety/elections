/**
 * Stable identifiers and tunables shared by every map layer in this page.
 *
 * MapLibre needs string ids for sources and layers; if two layers reference
 * the same source we have to use the same id everywhere. Hoisting them to a
 * single module means a designer can rename a layer without grepping the
 * whole page.
 */

// Initial map viewport — Bulgaria fits comfortably at zoom 7 from these.
export const BULGARIA_CENTER: [number, number] = [25.5, 42.7];
export const BULGARIA_ZOOM = 7;

// MapLibre source ids
export const BASE_SOURCE = "all-sections";
export const CIRCLE_SOURCE = "risk-sections"; // historic id; do not change without coordinated rename
export const MUNI_SOURCE = "municipality-boundaries";

// MapLibre layer ids
export const BASE_LAYER = "all-sections-circles";
export const CIRCLE_LAYER = "risk-circles";
export const CIRCLE_HOVER_LAYER = "risk-circles-hover";
export const MUNI_BORDER_LAYER = "municipality-borders";
export const SELECTED_LAYER = "selected-section-ring";

// Rounded-square warning icon used by the anomaly markers. We rasterize at
// a larger canvas than we ever display at so the SDF edges stay crisp when
// scaled down at low zoom. The "!" is rendered as a separate text glyph by
// MapLibre, not baked into this shape (SDF is single-colour).
export const WARNING_ICON = "anomaly-warning-square";
export const WARNING_ICON_SIZE = 96;

// Default threshold for what counts as "flagged" in the anomaly layer.
// The score columns are normalized to [0, 1]; 0.5 matches the old "medium"
// legend band. Protocol methodology ignores this and uses violation counts.
export const ANOMALY_MIN_RISK = 0.5;

// Sunflower-spiral overlap fix — keeps stacked sections from rendering on
// top of each other at the same coordinate.
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5°
export const OFFSET_RADIUS = 0.00018; // ~20 m at Bulgarian latitudes
