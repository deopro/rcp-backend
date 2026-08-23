/**
 * Capacity forecasting — daily capacity rolled up to week/month buckets with health status.
 */
import type { Core } from '@strapi/strapi'
import { computeCapacity } from '../capacity/calculate'
import { parseIsoDate, toIsoDate } from '../capacity/working-days'
import {
  findDepartmentIdsForManager,
  findEmployeeIdsInTeams,
  findProjectScopeEmployeeIds,
  findTeamIdsForLeader,
  findTeamIdsInDepartments,
} from '../../utils/employee-scope'

export type ForecastScope = 'org' | 'department' | 'team' | 'project'
export type ForecastGranularity = 'day' | 'week' | 'month'
export type ForecastHealth = 'over' | 'under' | 'healthy'

export type ForecastSeriesPoint = {
  period_start: string
  period_end: string
  label: string
  available_hours: number
  allocated_hours: number
  remaining_hours: number
  utilization_pct: number
  bench_pct: number
  over_allocated_hours: number
  health: ForecastHealth
}

export type ForecastBaseline = {
  available_hours: number
  allocated_hours: number
  remaining_hours: number
  utilization_pct: number
  bench_pct: number
  employees: number
  over_allocation_days: number
}

export type ProjectDemand = {
  project_id: number
  project_name: string
  capacity_hours: number
  allocated_hours: number
  remaining_hours: number
  demand_pct: number
}

export type ForecastResult = {
  status: 'ok'
  scope: ForecastScope
  granularity: ForecastGranularity
  from: string
  to: string
  filters: {
    department_id?: number | null
    team_id?: number | null
    project_id?: number | null
  }
  baseline: ForecastBaseline
  series: ForecastSeriesPoint[]
  project_demand?: ProjectDemand | null
}

const UNDER_UTILIZATION_THRESHOLD = 60

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

function healthFor(utilization: number, overHours: number): ForecastHealth {
  if (overHours > 0 || utilization > 100) return 'over'
  if (utilization < UNDER_UTILIZATION_THRESHOLD) return 'under'
  return 'healthy'
}

async function resolveScopedEmployeeIds(
  strapi: Core.Strapi,
  opts: {
    userId: number
    roleType: string | null
    scope: ForecastScope
    departmentId?: number
    teamId?: number
    projectId?: number
  },
): Promise<number[] | undefined> {
  if (opts.roleType === 'administrator' || opts.roleType === 'executive') {
    if (opts.scope === 'project' && opts.projectId) {
      return resolveProjectEmployeeIds(strapi, opts.projectId)
    }
    if (opts.teamId) {
      return findEmployeeIdsInTeams(strapi, [opts.teamId])
    }
    if (opts.departmentId) {
      const teamIds = await findTeamIdsInDepartments(strapi, [opts.departmentId])
      return findEmployeeIdsInTeams(strapi, teamIds)
    }
    return undefined
  }

  if (opts.roleType === 'team_leader') {
    const ledTeamIds = await findTeamIdsForLeader(strapi, opts.userId)
    if (!ledTeamIds.length) return []

    if (opts.scope === 'project' && opts.projectId) {
      const projectIds = await resolveProjectEmployeeIds(strapi, opts.projectId)
      const scoped = await findProjectScopeEmployeeIds(strapi, opts.roleType, opts.userId)
      return projectIds.filter((id) => scoped.includes(id))
    }

    let teamIds = ledTeamIds
    if (opts.teamId) {
      if (!ledTeamIds.includes(opts.teamId)) return []
      teamIds = [opts.teamId]
    }

    return findEmployeeIdsInTeams(strapi, teamIds)
  }

  if (opts.roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, opts.userId)
    const deptTeamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    if (!deptTeamIds.length) return []

    if (opts.scope === 'project' && opts.projectId) {
      const projectIds = await resolveProjectEmployeeIds(strapi, opts.projectId)
      const scoped = await findProjectScopeEmployeeIds(strapi, opts.roleType, opts.userId)
      return projectIds.filter((id) => scoped.includes(id))
    }

    let teamIds = deptTeamIds
    if (opts.departmentId) {
      if (!departmentIds.includes(opts.departmentId)) return []
      teamIds = await findTeamIdsInDepartments(strapi, [opts.departmentId])
    } else if (opts.teamId) {
      if (!deptTeamIds.includes(opts.teamId)) return []
      teamIds = [opts.teamId]
    }

    return findEmployeeIdsInTeams(strapi, teamIds)
  }

  if (opts.roleType === 'employee') {
    return findProjectScopeEmployeeIds(strapi, opts.roleType, opts.userId)
  }

  return []
}

async function resolveProjectEmployeeIds(
  strapi: Core.Strapi,
  projectId: number,
): Promise<number[]> {
  const project = await strapi.db.query('api::project.project').findOne({
    where: { id: projectId },
    populate: ['assigned_employees'],
  })
  const assigned = (project?.assigned_employees || []).map((e: { id: number }) => e.id)
  const allocRows = await strapi.db.query('api::allocation.allocation').findMany({
    where: { project: projectId },
    populate: ['employee'],
  })
  const fromAlloc = allocRows
    .map((r: { employee?: { id?: number } }) => r.employee?.id)
    .filter((id): id is number => typeof id === 'number')
  return [...new Set([...assigned, ...fromAlloc])]
}

async function loadProjectAllocatedHours(
  strapi: Core.Strapi,
  projectId: number,
  employeeIds: number[],
  from: string,
  to: string,
): Promise<Map<string, number>> {
  if (!employeeIds.length) return new Map()

  const rows = await strapi.db.query('api::allocation.allocation').findMany({
    where: {
      project: projectId,
      employee: { id: { $in: employeeIds } },
      allocation_date: { $gte: from, $lte: to },
    },
    populate: ['employee'],
  })

  const map = new Map<string, number>()
  for (const row of rows) {
    const empId = row.employee?.id as number | undefined
    if (!empId) continue
    const key = `${empId}:${row.allocation_date}`
    map.set(key, (map.get(key) || 0) + Number(row.hours || 0))
  }
  return map
}

type DayAggregate = {
  date: string
  available_hours: number
  allocated_hours: number
  over_allocated_hours: number
}

function aggregateDaily(
  capacity: Awaited<ReturnType<typeof computeCapacity>>,
  projectAllocMap?: Map<string, number>,
): DayAggregate[] {
  const dayMap = new Map<string, DayAggregate>()

  for (const emp of capacity.employees) {
    for (const day of emp.days) {
      const allocated =
        projectAllocMap?.get(`${emp.employee_id}:${day.date}`) ?? day.allocated_hours
      const available = day.available_hours
      const over = Math.max(0, Math.round((allocated - available) * 100) / 100)

      const cur = dayMap.get(day.date) || {
        date: day.date,
        available_hours: 0,
        allocated_hours: 0,
        over_allocated_hours: 0,
      }
      cur.available_hours += available
      cur.allocated_hours += allocated
      cur.over_allocated_hours += over
      dayMap.set(day.date, cur)
    }
  }

  return [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function mondayOfWeek(iso: string): string {
  const d = parseIsoDate(iso)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return toIsoDate(d)
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function bucketDays(
  days: DayAggregate[],
  granularity: ForecastGranularity,
): ForecastSeriesPoint[] {
  if (granularity === 'day') {
    return days.map((d) => {
      const remaining = Math.max(0, d.available_hours - d.allocated_hours)
      const util = pct(d.allocated_hours, d.available_hours)
      return {
        period_start: d.date,
        period_end: d.date,
        label: d.date,
        available_hours: Math.round(d.available_hours * 100) / 100,
        allocated_hours: Math.round(d.allocated_hours * 100) / 100,
        remaining_hours: Math.round(remaining * 100) / 100,
        utilization_pct: util,
        bench_pct: pct(remaining, d.available_hours),
        over_allocated_hours: Math.round(d.over_allocated_hours * 100) / 100,
        health: healthFor(util, d.over_allocated_hours),
      }
    })
  }

  const buckets = new Map<string, DayAggregate[]>()

  for (const d of days) {
    const key = granularity === 'week' ? mondayOfWeek(d.date) : monthKey(d.date)
    const list = buckets.get(key) || []
    list.push(d)
    buckets.set(key, list)
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucketDaysList]) => {
      const start = bucketDaysList[0]!.date
      const end = bucketDaysList[bucketDaysList.length - 1]!.date
      const available = bucketDaysList.reduce((s, d) => s + d.available_hours, 0)
      const allocated = bucketDaysList.reduce((s, d) => s + d.allocated_hours, 0)
      const over = bucketDaysList.reduce((s, d) => s + d.over_allocated_hours, 0)
      const remaining = Math.max(0, available - allocated)
      const util = pct(allocated, available)

      const label =
        granularity === 'week'
          ? `${start} – ${end}`
          : key

      return {
        period_start: start,
        period_end: end,
        label,
        available_hours: Math.round(available * 100) / 100,
        allocated_hours: Math.round(allocated * 100) / 100,
        remaining_hours: Math.round(remaining * 100) / 100,
        utilization_pct: util,
        bench_pct: pct(remaining, available),
        over_allocated_hours: Math.round(over * 100) / 100,
        health: healthFor(util, over),
      }
    })
}

async function loadProjectDemand(
  strapi: Core.Strapi,
  projectId: number,
  from: string,
  to: string,
): Promise<ProjectDemand | null> {
  const project = await strapi.db.query('api::project.project').findOne({
    where: { id: projectId },
    populate: ['assigned_employees'],
  })
  if (!project) return null

  const employees = (project.assigned_employees || []).filter(
    (e: { status?: string }) => e.status !== 'inactive',
  )
  const empIds = employees.map((e: { id: number }) => e.id)

  const capacity = await computeCapacity(strapi, {
    from,
    to,
    employeeIds: empIds.length ? empIds : [],
  })

  const projectAlloc = await loadProjectAllocatedHours(strapi, projectId, empIds, from, to)
  const daily = aggregateDaily(capacity, projectAlloc)

  const available = daily.reduce((s, d) => s + d.available_hours, 0)
  const allocated = daily.reduce((s, d) => s + d.allocated_hours, 0)
  const remaining = Math.max(0, available - allocated)

  return {
    project_id: project.id,
    project_name: project.name,
    capacity_hours: Math.round(available * 100) / 100,
    allocated_hours: Math.round(allocated * 100) / 100,
    remaining_hours: Math.round(remaining * 100) / 100,
    demand_pct: pct(allocated, available),
  }
}

function emptyResult(opts: {
  scope: ForecastScope
  granularity: ForecastGranularity
  from: string
  to: string
  departmentId?: number
  teamId?: number
  projectId?: number
}): ForecastResult {
  return {
    status: 'ok',
    scope: opts.scope,
    granularity: opts.granularity,
    from: opts.from,
    to: opts.to,
    filters: {
      department_id: opts.departmentId ?? null,
      team_id: opts.teamId ?? null,
      project_id: opts.projectId ?? null,
    },
    baseline: {
      available_hours: 0,
      allocated_hours: 0,
      remaining_hours: 0,
      utilization_pct: 0,
      bench_pct: 0,
      employees: 0,
      over_allocation_days: 0,
    },
    series: [],
    project_demand: null,
  }
}

export async function computeForecast(
  strapi: Core.Strapi,
  opts: {
    from: string
    to: string
    scope?: ForecastScope
    granularity?: ForecastGranularity
    userId: number
    roleType: string | null
    departmentId?: number
    teamId?: number
    projectId?: number
  },
): Promise<ForecastResult> {
  let scope = opts.scope || 'org'
  const granularity = opts.granularity || 'week'

  if (opts.roleType === 'team_leader' && (scope === 'org' || scope === 'department')) {
    scope = 'team'
  }
  if (opts.roleType === 'department_manager' && scope === 'org') {
    scope = 'department'
  }

  const employeeIds = await resolveScopedEmployeeIds(strapi, {
    userId: opts.userId,
    roleType: opts.roleType,
    scope,
    departmentId: opts.departmentId,
    teamId: opts.teamId,
    projectId: opts.projectId,
  })

  if (employeeIds && employeeIds.length === 0) {
    return emptyResult({ ...opts, scope, granularity })
  }

  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    employeeIds: employeeIds ?? undefined,
    teamId: opts.teamId,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  let projectAllocMap: Map<string, number> | undefined
  if (opts.projectId && capacity.employees.length) {
    projectAllocMap = await loadProjectAllocatedHours(
      strapi,
      opts.projectId,
      capacity.employees.map((e) => e.employee_id),
      capacity.from,
      capacity.to,
    )
  }

  const daily = aggregateDaily(capacity, projectAllocMap)
  const series = bucketDays(daily, granularity)

  const totalAvailable = daily.reduce((s, d) => s + d.available_hours, 0)
  const totalAllocated = daily.reduce((s, d) => s + d.allocated_hours, 0)
  const totalRemaining = Math.max(0, totalAvailable - totalAllocated)
  const overDays = daily.filter((d) => d.over_allocated_hours > 0).length

  let project_demand: ProjectDemand | null = null
  if (scope === 'project' && opts.projectId) {
    project_demand = await loadProjectDemand(strapi, opts.projectId, capacity.from, capacity.to)
  }

  return {
    status: 'ok',
    scope,
    granularity,
    from: capacity.from,
    to: capacity.to,
    filters: {
      department_id: opts.departmentId ?? null,
      team_id: opts.teamId ?? null,
      project_id: opts.projectId ?? null,
    },
    baseline: {
      available_hours: Math.round(totalAvailable * 100) / 100,
      allocated_hours: Math.round(totalAllocated * 100) / 100,
      remaining_hours: Math.round(totalRemaining * 100) / 100,
      utilization_pct: pct(totalAllocated, totalAvailable),
      bench_pct: pct(totalRemaining, totalAvailable),
      employees: capacity.employees.length,
      over_allocation_days: overDays,
    },
    series,
    project_demand,
  }
}
