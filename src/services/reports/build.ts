/**
 * Report data builders — reuse capacity, bench, forecast, and dashboard services.
 */
import type { Core } from '@strapi/strapi'
import { computeCapacity } from '../capacity/calculate'
import { eachDay, toIsoDate } from '../capacity/working-days'
import { computeBench } from '../bench/calculate'
import { computeDashboard } from '../dashboard/calculate'
import { computeForecast } from '../forecast/calculate'
import { columnLabel, columns, healthLabel, reportTitle, sheetName } from './i18n'
import type { ReportDocument, ReportQuery, ReportType } from './types'

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function monthLabel(iso: string, locale: string): string {
  const [y, m] = iso.split('-')
  const pt = locale.startsWith('pt')
  const namesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const namesPt = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const idx = Number(m) - 1
  const name = pt ? namesPt[idx] : namesEn[idx]
  return `${name} ${y}`
}

async function loadAllocationRows(
  strapi: Core.Strapi,
  opts: ReportQuery,
  employeeIds: number[],
) {
  if (!employeeIds.length) return []

  const where: Record<string, unknown> = {
    employee: { id: { $in: employeeIds } },
    allocation_date: { $gte: opts.from, $lte: opts.to },
  }
  if (opts.projectId) where.project = opts.projectId

  return strapi.db.query('api::allocation.allocation').findMany({
    where,
    populate: ['employee', 'employee.team', 'project'],
    orderBy: [{ allocation_date: 'asc' }, { id: 'asc' }],
  })
}

async function resolveEmployeeIds(strapi: Core.Strapi, opts: ReportQuery): Promise<number[]> {
  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    employeeIds: opts.employeeId ? [opts.employeeId] : undefined,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  let rows = capacity.employees
  if (opts.departmentId) {
    const deptTeams = await strapi.db.query('api::team.team').findMany({
      where: { department: opts.departmentId },
      select: ['id'],
    })
    const teamIds = new Set(deptTeams.map((t: { id: number }) => t.id))
    rows = rows.filter((e) => e.team_id && teamIds.has(e.team_id))
  }
  if (opts.projectId) {
    const allocEmpIds = new Set(
      (
        await strapi.db.query('api::allocation.allocation').findMany({
          where: { project: opts.projectId, allocation_date: { $gte: opts.from, $lte: opts.to } },
          populate: ['employee'],
        })
      )
        .map((r: { employee?: { id?: number } }) => r.employee?.id)
        .filter((id): id is number => typeof id === 'number'),
    )
    rows = rows.filter((e) => allocEmpIds.has(e.employee_id))
  }

  return rows.map((e) => e.employee_id)
}

export async function buildReport(
  strapi: Core.Strapi,
  type: ReportType,
  opts: ReportQuery,
): Promise<ReportDocument> {
  const generatedAt = new Date().toISOString()
  const base = {
    type,
    title: reportTitle(type, opts.locale),
    generatedAt,
    period: { from: opts.from, to: opts.to },
  }

  switch (type) {
    case 'monthly-capacity':
      return { ...base, sheets: [await buildMonthlyCapacity(strapi, opts)] }
    case 'employee-allocation':
      return { ...base, sheets: await buildEmployeeAllocation(strapi, opts) }
    case 'project-allocation':
      return { ...base, sheets: [await buildProjectAllocation(strapi, opts)] }
    case 'team':
      return { ...base, sheets: [await buildTeamReport(strapi, opts)] }
    case 'department':
      return { ...base, sheets: [await buildDepartmentReport(strapi, opts)] }
    case 'executive':
      return { ...base, sheets: await buildExecutiveReport(strapi, opts) }
    case 'utilization':
      return { ...base, sheets: [await buildUtilizationReport(strapi, opts)] }
    case 'bench':
      return { ...base, sheets: [await buildBenchReport(strapi, opts)] }
    case 'skills':
      return { ...base, sheets: [await buildSkillsReport(strapi, opts)] }
    case 'forecast':
      return { ...base, sheets: [await buildForecastReport(strapi, opts)] }
    default:
      throw new Error(`Unknown report type: ${String(type)}`)
  }
}

async function buildMonthlyCapacity(strapi: Core.Strapi, opts: ReportQuery) {
  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    employeeIds: opts.employeeId ? [opts.employeeId] : undefined,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const rows: Record<string, string | number>[] = []
  for (const emp of capacity.employees) {
    const byMonth = new Map<string, { available: number; allocated: number }>()
    for (const day of emp.days) {
      if (!day.is_working_day) continue
      const key = monthKey(day.date)
      const cur = byMonth.get(key) || { available: 0, allocated: 0 }
      cur.available += day.available_hours
      cur.allocated += day.allocated_hours
      byMonth.set(key, cur)
    }
    for (const [key, totals] of byMonth) {
      const remaining = Math.max(0, totals.available - totals.allocated)
      rows.push({
        month: monthLabel(`${key}-01`, opts.locale),
        employee: emp.full_name,
        team: emp.team_name || '',
        available: Math.round(totals.available * 100) / 100,
        allocated: Math.round(totals.allocated * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        utilization: pct(totals.allocated, totals.available),
      })
    }
  }

  return {
    name: sheetName('data', opts.locale),
    columns: columns(['month', 'employee', 'team', 'available', 'allocated', 'remaining', 'utilization'], opts.locale),
    rows,
  }
}

async function buildEmployeeAllocation(strapi: Core.Strapi, opts: ReportQuery) {
  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    employeeIds: opts.employeeId ? [opts.employeeId] : undefined,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const days = eachDay(new Date(`${opts.from}T12:00:00`), new Date(`${opts.to}T12:00:00`)).map(toIsoDate)

  const matrixRows: Record<string, string | number>[] = capacity.employees.map((emp) => {
    const row: Record<string, string | number> = {
      employee: emp.full_name,
      team: emp.team_name || '',
    }
    let total = 0
    for (const day of emp.days) {
      const key = `d_${day.date.replace(/-/g, '')}`
      if (day.allocated_hours > 0) {
        row[key] = day.allocated_hours
        total += day.allocated_hours
      }
    }
    row.total = Math.round(total * 100) / 100
    return row
  })

  const matrixColumns = [
    ...columns(['employee', 'team'], opts.locale),
    ...days.map((d) => ({ key: `d_${d.replace(/-/g, '')}`, label: d, width: 11 })),
    { key: 'total', label: columnLabel('total', opts.locale), width: 10 },
  ]

  const summaryRows = capacity.employees.map((emp) => {
    const available = emp.days.reduce((s, d) => s + d.available_hours, 0)
    const allocated = emp.days.reduce((s, d) => s + d.allocated_hours, 0)
    const remaining = Math.max(0, available - allocated)
    return {
      employee: emp.full_name,
      team: emp.team_name || '',
      available: Math.round(available * 100) / 100,
      allocated: Math.round(allocated * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      utilization: pct(allocated, available),
    }
  })

  return [
    {
      name: sheetName('matrix', opts.locale),
      columns: matrixColumns,
      rows: matrixRows,
    },
    {
      name: sheetName('summary', opts.locale),
      columns: columns(['employee', 'team', 'available', 'allocated', 'remaining', 'utilization'], opts.locale),
      rows: summaryRows,
    },
  ]
}

async function buildProjectAllocation(strapi: Core.Strapi, opts: ReportQuery) {
  const employeeIds = await resolveEmployeeIds(strapi, opts)
  const allocations = await loadAllocationRows(strapi, opts, employeeIds)

  const rows = allocations.map(
    (row: {
      allocation_date: string
      hours: number
      status?: string
      notes?: string
      project?: { name?: string }
      employee?: { full_name?: string; team?: { name?: string } }
    }) => ({
      date: String(row.allocation_date).slice(0, 10),
      project: row.project?.name || '',
      employee: row.employee?.full_name || '',
      team: row.employee?.team?.name || '',
      hours: Number(row.hours || 0),
      status: row.status || '',
      notes: row.notes || '',
    }),
  )

  return {
    name: sheetName('data', opts.locale),
    columns: columns(['date', 'project', 'employee', 'team', 'hours', 'status', 'notes'], opts.locale),
    rows,
  }
}

async function buildTeamReport(strapi: Core.Strapi, opts: ReportQuery) {
  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const map = new Map<
    number,
    { name: string; employees: Set<number>; available: number; allocated: number }
  >()

  for (const emp of capacity.employees) {
    const teamId = emp.team_id || 0
    const name = emp.team_name || `#${teamId}`
    const cur = map.get(teamId) || { name, employees: new Set<number>(), available: 0, allocated: 0 }
    cur.employees.add(emp.employee_id)
    for (const day of emp.days) {
      cur.available += day.available_hours
      cur.allocated += day.allocated_hours
    }
    map.set(teamId, cur)
  }

  const rows = [...map.values()]
    .map((team) => {
      const remaining = Math.max(0, team.available - team.allocated)
      return {
        team: team.name,
        employees: team.employees.size,
        available: Math.round(team.available * 100) / 100,
        allocated: Math.round(team.allocated * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        utilization: pct(team.allocated, team.available),
        bench: pct(remaining, team.available),
      }
    })
    .sort((a, b) => String(a.team).localeCompare(String(b.team)))

  return {
    name: sheetName('teams', opts.locale),
    columns: columns(['team', 'employees', 'available', 'allocated', 'remaining', 'utilization', 'bench'], opts.locale),
    rows,
  }
}

async function buildDepartmentReport(strapi: Core.Strapi, opts: ReportQuery) {
  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const teamDept = new Map<number, string>()
  const teams = await strapi.db.query('api::team.team').findMany({
    populate: ['department'],
  })
  for (const team of teams) {
    const dept = team.department as { id?: number; name?: string } | undefined
    if (dept?.id) teamDept.set(team.id as number, dept.name || `#${dept.id}`)
  }

  const map = new Map<string, { employees: Set<number>; available: number; allocated: number }>()
  for (const emp of capacity.employees) {
    const deptName = emp.team_id ? teamDept.get(emp.team_id) || '' : ''
    const key = deptName || '—'
    const cur = map.get(key) || { employees: new Set<number>(), available: 0, allocated: 0 }
    cur.employees.add(emp.employee_id)
    for (const day of emp.days) {
      cur.available += day.available_hours
      cur.allocated += day.allocated_hours
    }
    map.set(key, cur)
  }

  const rows = [...map.entries()]
    .map(([department, totals]) => {
      const remaining = Math.max(0, totals.available - totals.allocated)
      return {
        department,
        employees: totals.employees.size,
        available: Math.round(totals.available * 100) / 100,
        allocated: Math.round(totals.allocated * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        utilization: pct(totals.allocated, totals.available),
      }
    })
    .sort((a, b) => String(a.department).localeCompare(String(b.department)))

  return {
    name: sheetName('data', opts.locale),
    columns: columns(['department', 'employees', 'available', 'allocated', 'remaining', 'utilization'], opts.locale),
    rows,
  }
}

async function buildExecutiveReport(strapi: Core.Strapi, opts: ReportQuery) {
  const dashboard = await computeDashboard(strapi, {
    from: opts.from,
    to: opts.to,
    userId: opts.userId,
    roleType: opts.roleType,
    departmentId: opts.departmentId,
    teamId: opts.teamId,
    projectId: opts.projectId,
    employeeId: opts.employeeId,
  })

  const kpiRows = [
    { kpi: columnLabel('employees', opts.locale), value: dashboard.kpis.employees },
    { kpi: columnLabel('utilization', opts.locale), value: `${dashboard.kpis.utilization_pct}%` },
    { kpi: columnLabel('bench', opts.locale), value: `${dashboard.kpis.bench_pct}%` },
    { kpi: columnLabel('available', opts.locale), value: dashboard.kpis.available_hours },
    { kpi: columnLabel('allocated', opts.locale), value: dashboard.kpis.allocated_hours },
    { kpi: columnLabel('remaining', opts.locale), value: dashboard.kpis.remaining_hours },
    { kpi: columnLabel('active_projects', opts.locale), value: dashboard.kpis.active_projects },
    { kpi: columnLabel('pending_approvals', opts.locale), value: dashboard.kpis.pending_approvals },
    { kpi: columnLabel('pending_leave', opts.locale), value: dashboard.kpis.pending_leave },
  ]

  const teamRows = dashboard.charts.utilization_by_team.map((team) => ({
    team: team.team_name,
    available: team.available_hours,
    allocated: team.allocated_hours,
    utilization: team.utilization_pct,
    bench: team.bench_pct,
  }))

  const projectRows = dashboard.charts.allocation_by_project.map((project) => ({
    project: project.project_name,
    hours: project.hours,
  }))

  return [
    {
      name: sheetName('kpis', opts.locale),
      columns: columns(['kpi', 'value'], opts.locale),
      rows: kpiRows,
    },
    {
      name: sheetName('teams', opts.locale),
      columns: columns(['team', 'available', 'allocated', 'utilization', 'bench'], opts.locale),
      rows: teamRows,
    },
    {
      name: sheetName('projects', opts.locale),
      columns: columns(['project', 'hours'], opts.locale),
      rows: projectRows,
    },
  ]
}

async function buildUtilizationReport(strapi: Core.Strapi, opts: ReportQuery) {
  const capacity = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    employeeIds: opts.employeeId ? [opts.employeeId] : undefined,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const rows = capacity.employees.map((emp) => {
    const available = emp.days.reduce((s, d) => s + d.available_hours, 0)
    const allocated = emp.days.reduce((s, d) => s + d.allocated_hours, 0)
    const remaining = Math.max(0, available - allocated)
    return {
      employee: emp.full_name,
      team: emp.team_name || '',
      available: Math.round(available * 100) / 100,
      allocated: Math.round(allocated * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      utilization: pct(allocated, available),
      bench: pct(remaining, available),
    }
  })

  return {
    name: sheetName('data', opts.locale),
    columns: columns(['employee', 'team', 'available', 'allocated', 'remaining', 'utilization', 'bench'], opts.locale),
    rows,
  }
}

async function buildBenchReport(strapi: Core.Strapi, opts: ReportQuery) {
  const bench = await computeBench(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const rows = bench.employees.map((emp) => ({
    employee: emp.full_name,
    team: emp.team_name || '',
    available: emp.available_hours,
    allocated: emp.allocated_hours,
    remaining: emp.remaining_hours,
    utilization: emp.utilization_pct,
    bench: emp.bench_pct,
  }))

  return {
    name: sheetName('data', opts.locale),
    columns: columns(['employee', 'team', 'available', 'allocated', 'remaining', 'utilization', 'bench'], opts.locale),
    rows,
  }
}

async function buildSkillsReport(strapi: Core.Strapi, opts: ReportQuery) {
  const employeeIds = await resolveEmployeeIds(strapi, opts)
  if (!employeeIds.length) {
    return {
      name: sheetName('data', opts.locale),
      columns: columns(['employee', 'team', 'skill', 'proficiency'], opts.locale),
      rows: [],
    }
  }

  const rows = (
    await strapi.db.query('api::employee-skill.employee-skill').findMany({
      where: { employee: { id: { $in: employeeIds } } },
      populate: ['employee', 'employee.team', 'skill'],
      orderBy: [{ employee: { full_name: 'asc' } }, { id: 'asc' }],
    })
  ).map(
    (row: {
      proficiency_level?: string
      employee?: { full_name?: string; team?: { name?: string } }
      skill?: { name?: string }
    }) => ({
      employee: row.employee?.full_name || '',
      team: row.employee?.team?.name || '',
      skill: row.skill?.name || '',
      proficiency: row.proficiency_level || '',
    }),
  )

  return {
    name: sheetName('data', opts.locale),
    columns: columns(['employee', 'team', 'skill', 'proficiency'], opts.locale),
    rows,
  }
}

async function buildForecastReport(strapi: Core.Strapi, opts: ReportQuery) {
  const scope = opts.scope || 'org'
  const granularity = opts.granularity || 'week'

  const forecast = await computeForecast(strapi, {
    from: opts.from,
    to: opts.to,
    scope,
    granularity,
    userId: opts.userId,
    roleType: opts.roleType,
    departmentId: opts.departmentId,
    teamId: opts.teamId,
    projectId: opts.projectId,
  })

  const rows = forecast.series.map((point) => ({
    period: point.label,
    from: point.period_start,
    to: point.period_end,
    available: point.available_hours,
    allocated: point.allocated_hours,
    remaining: point.remaining_hours,
    utilization: point.utilization_pct,
    bench: point.bench_pct,
    over: point.over_allocated_hours,
    health: healthLabel(point.health, opts.locale),
  }))

  return {
    name: sheetName('series', opts.locale),
    columns: columns(
      ['period', 'from', 'to', 'available', 'allocated', 'remaining', 'utilization', 'bench', 'over', 'health'],
      opts.locale,
    ),
    rows,
  }
}
