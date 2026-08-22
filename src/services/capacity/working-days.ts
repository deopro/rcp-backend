/** Working-day utilities — weekends excluded; holidays/leave hooks for M7. */

export function parseIsoDate(value: string | Date): Date {
  const d = value instanceof Date ? new Date(value) : new Date(value)
  d.setHours(0, 0, 0, 0)
  return d
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

export function isWorkingDay(
  d: Date,
  holidayDates: Set<string> = new Set(),
  leaveDates: Set<string> = new Set(),
): boolean {
  const iso = toIsoDate(d)
  if (isWeekend(d)) return false
  if (holidayDates.has(iso)) return false
  if (leaveDates.has(iso)) return false
  return true
}

export function eachDay(from: Date, to: Date): Date[] {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  const days: Date[] = []
  const cur = new Date(start)
  while (cur <= end) {
    days.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function previousWeekday(d: Date): Date {
  let cur = addDays(d, -1)
  while (isWeekend(cur)) {
    cur = addDays(cur, -1)
  }
  return cur
}

export { countWeekdays } from '../projects/summary'
