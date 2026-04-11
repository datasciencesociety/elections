/**
 * Largest-remainder percentage rounding.
 *
 * Plain `(part / total) * 100` rounded to one decimal sums to 99.9 or 100.1.
 * The largest-remainder method floors every share to the nearest 0.1, then
 * distributes the remaining 0.1 increments to whichever entries have the
 * biggest fractional remainder. Result: percentages always sum to exactly
 * 100.0 (or 0 when total is 0).
 *
 * Used by /api/elections/compare to keep cross-election bars stacking cleanly.
 */

export function largestRemainderPercents(
  parts: number[],
  total: number,
): number[] {
  if (total <= 0) return parts.map(() => 0);

  const exact = parts.map((p) => (p / total) * 100);
  const floored = exact.map((e) => Math.floor(e * 10) / 10);

  const remainders = exact.map((e, i) => ({
    index: i,
    remainder: Math.round((e * 10 - Math.floor(e * 10)) * 1e9) / 1e9,
  }));

  const currentTenths = Math.round(floored.reduce((a, b) => a + b, 0) * 10);
  const targetTenths = 1000; // 100.0 expressed in tenths
  let toDistribute = targetTenths - currentTenths;

  remainders.sort((a, b) => b.remainder - a.remainder);
  for (const r of remainders) {
    if (toDistribute <= 0) break;
    floored[r.index] = Math.round((floored[r.index] + 0.1) * 10) / 10;
    toDistribute--;
  }
  return floored;
}
