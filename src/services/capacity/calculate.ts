/**
 * Capacity calculation — per employee per day (M6).
 * Holidays and leave sets are empty until Milestone 7.
 */
import type { Core } from '@strapi/strapi'
import { eachDay, isWorkingDay, parseIsoDate, toIsoDate } from './working-days'

export type DayCapacity = {
  date: string
  is_working_day: boolean
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
  employees: EmployeeCapacityRow[]
}

type AllocationRow = {
  allocation_date: string
  hours: number
  employee?: { id: number }
}

async function loadHolidayDates(_strapi: Core.Strapi): Promise<Set<string>> {
  // Milestone 7 — stub returns empty
  return new Set()
}

async function loadLeaveDates(
  _strapi: Core.Strapi,
  _employeeIds: number[],
  _from: string,
  _to: string,
): Promise<Map<number, Set<string>>> {
  // Milestone 7 — stub returns empty per employee
  return new Map()
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
    loadHolidayDates(strapi),
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
        const working = isWorkingDay(day, holidayDates, leaveDates)
        const available = working ? daily : 0
        const allocated = allocatedMap.get(`${employee.id}:${iso}`) || 0
        const remaining = Math.max(0, Math.round((available - allocated) * 100) / 100)

        return {
          date: iso,
          is_working_day: working,
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

  return { from: fromIso, to: toIso, employees: rows }
}
