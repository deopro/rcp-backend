/** Working-day utilities — weekends, holidays, and leave reduce available capacity. */

export function parseIsoDate(value: string | Date): Date {
  const d = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`)
  d.setHours(0, 0, 0, 0)
  return d
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

export function eachDay(from: Date | string, to: Date | string): Date[] {
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

/** Expand an inclusive leave range into weekday ISO dates (weekends still excluded from leave set). */
export function expandDateRangeToIso(from: string, to: string): string[] {
  return eachDay(from, to).map(toIsoDate)
}

export function countWorkingDays(
  from: Date | string,
  to: Date | string,
  holidayDates: Set<string> = new Set(),
  leaveDates: Set<string> = new Set(),
): number {
  return eachDay(from, to).filter((d) => isWorkingDay(d, holidayDates, leaveDates)).length
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

/** Weekdays only (no holiday/leave awareness) — kept for project summary compatibility. */
export function countWeekdays(from: Date, to: Date): number {
  return countWorkingDays(from, to)
}
