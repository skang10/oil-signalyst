import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(digits)}%`
}

export function formatMB(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

export function formatUsd(value: number | null | undefined, digits = 2): string {
  return value == null ? '$—' : `$${value.toFixed(digits)}`
}

/** ISO date (YYYY-MM-DD) -> short month label, e.g. "Nov '25". */
export function formatShortMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', " '")
}

/** Last N business days (Mon-Fri) ending at `endDate` (inclusive), formatted M/D. */
export function lastBusinessDayLabels(endDate: string, n: number): string[] {
  const labels: string[] = []
  const cursor = new Date(`${endDate}T00:00:00Z`)
  while (labels.length < n) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      labels.unshift(`${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}`)
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return labels
}
