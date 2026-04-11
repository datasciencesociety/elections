import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a percentage to two decimal places by truncation (not rounding).
 * 99.997% stays "99.99%" instead of becoming "100.00%". Used wherever the
 * UI shows turnout or vote shares.
 */
export function pct2(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}
