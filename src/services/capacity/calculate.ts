/**
 * Capacity calculation — per employee per day.
 * Available hours exclude weekends, public holidays, and approved leave.
 */
import type { Core } from '@strapi/strapi'
import {
  eachDay,
  expandDateRangeToIso,
  isWorkingDay,
  parseIsoDate,
  toIsoDate,
} from './working-days'

export type DayCapacity = {
  date: string
  is_working_day: boolean
  is_holiday: boolean
  is_leave: boolean
  daily_capacity: number
  available_hours: number
  allocated_hours: number
  remaining_hours: number
}

export type EmployeeCapacityRow = {
  employee_id: number
  document_id: string
  full_name: string
  team_id?: number | null
  team_name?: string | null
  days: DayCapacity[]
}

export type CapacityResult = {
  from: string
  to: string
  holiday_dates: string[]
  employees: EmployeeCapacityRow[]
}

type AllocationRow = {
  allocation_date: string
  hours: number
  employee?: { id: number }
}

type LeaveRow = {
  start_date: string
  end_date: string
  employee?: { id: number }
}

export async function loadHolidayDates(
  strapi: Core.Strapi,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await strapi.db.query('api::holiday.holiday').findMany({
    where: {
      date: { $gte: from, $lte: to },
    },
  })
  return new Set(rows.map((r: { date: string }) => String(r.date).slice(0, 10)))
}

export async function loadLeaveDates(
  strapi: Core.Strapi,
  employeeIds: number[],
  from: string,
  to: string,
): Promise<Map<number, Set<string>>> {
  const map = new Map<number, Set<string>>()
  if (!employeeIds.length) return map

  const leaves = (await strapi.db.query('api::leave.leave').findMany({
    where: {
      status: 'approved',
      employee: { id: { $in: employeeIds } },
      start_date: { $lte: to },
      end_date: { $gte: from },
    },
    populate: ['employee'],
  })) as LeaveRow[]

  for (const leave of leaves) {
    const empId = leave.employee?.id
    if (!empId) continue
    const dates = expandDateRangeToIso(leave.start_date, leave.end_date)
    let set = map.get(empId)
    if (!set) {
      set = new Set()
      map.set(empId, set)
    }
    for (const iso of dates) {
      if (iso >= from && iso <= to) set.add(iso)
    }
  }

  return map
}

async function loadAllocatedHours(
  strapi: Core.Strapi,
  employeeIds: number[],
  from: string,
  to: string,
): Promise<Map<string, number>> {
  if (!employeeIds.length) return new Map()

  const allocations = (await strapi.db.query('api::allocation.allocation').findMany({
    where: {
      employee: { id: { $in: employeeIds } },
      allocation_date: { $gte: from, $lte: to },
    },
    populate: ['employee'],
  })) as AllocationRow[]

  const map = new Map<string, number>()
  for (const row of allocations) {
    const empId = row.employee?.id
    if (!empId) continue
    const key = `${empId}:${row.allocation_date}`
    map.set(key, (map.get(key) || 0) + Number(row.hours || 0))
  }
  return map
}

export async function computeCapacity(
  strapi: Core.Strapi,
  opts: {
    from: string
    to: string
    employeeIds?: number[]
    teamId?: number
    userId?: number
    roleType?: string | null
  },
): Promise<CapacityResult> {
  const from = parseIsoDate(opts.from)
  const to = parseIsoDate(opts.to)
  const fromIso = toIsoDate(from)
  const toIso = toIsoDate(to)

  const employeeWhere: Record<string, unknown> = { status: 'active' }
  if (opts.employeeIds?.length) {
    employeeWhere.id = { $in: opts.employeeIds }
  }
  if (opts.teamId) {
    employeeWhere.team = opts.teamId
  }

  if (opts.userId && opts.roleType === 'employee') {
    employeeWhere.user = opts.userId
  } else if (opts.userId && opts.roleType === 'team_leader') {
    employeeWhere.team = { team_leader: opts.userId }
  } else if (opts.userId && opts.roleType === 'department_manager') {
    employeeWhere.team = { department: { manager: opts.userId } }
  }

  const employees = await strapi.db.query('api::employee.employee').findMany({
    where: employeeWhere,
    populate: ['team'],
    orderBy: { full_name: 'asc' },
  })

  const ids = employees.map((e: { id: number }) => e.id)
  const [holidayDates, leaveByEmployee, allocatedMap] = await Promise.all([
    loadHolidayDates(strapi, fromIso, toIso),
    loadLeaveDates(strapi, ids, fromIso, toIso),
    loadAllocatedHours(strapi, ids, fromIso, toIso),
  ])

  const calendarDays = eachDay(from, to)

  const rows: EmployeeCapacityRow[] = employees.map(
    (employee: {
      id: number
      documentId: string
      full_name: string
      daily_capacity?: number
      team?: { id: number; name?: string } | null
    }) => {
      const daily = Number(employee.daily_capacity ?? 8)
      const leaveDates = leaveByEmployee.get(employee.id) || new Set<string>()

      const days: DayCapacity[] = calendarDays.map((day) => {
        const iso = toIsoDate(day)
        const isHoliday = holidayDates.has(iso)
        const isLeave = leaveDates.has(iso)
        const working = isWorkingDay(day, holidayDates, leaveDates)
        const available = working ? daily : 0
        const allocated = allocatedMap.get(`${employee.id}:${iso}`) || 0
        const remaining = Math.max(0, Math.round((available - allocated) * 100) / 100)

        return {
          date: iso,
          is_working_day: working,
          is_holiday: isHoliday,
          is_leave: isLeave,
          daily_capacity: daily,
          available_hours: available,
          allocated_hours: Math.round(allocated * 100) / 100,
          remaining_hours: remaining,
        }
      })

      return {
        employee_id: employee.id,
        document_id: employee.documentId,
        full_name: employee.full_name,
        team_id: employee.team?.id ?? null,
        team_name: employee.team?.name ?? null,
        days,
      }
    },
  )

  return {
    from: fromIso,
    to: toIso,
    holiday_dates: [...holidayDates].sort(),
    employees: rows,
  }
}
