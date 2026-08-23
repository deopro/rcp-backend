/**
 * Role-scoped dashboard KPIs, charts, and pending items.
 */
import type { Core } from '@strapi/strapi'
import { computeCapacity, type CapacityResult } from '../capacity/calculate'

export type DashboardKpis = {
  employees: number
  available_hours: number
  allocated_hours: number
  remaining_hours: number
  utilization_pct: number
  bench_pct: number
  active_projects: number
  pending_approvals: number
  pending_leave: number
}

export type DaySeriesPoint = {
  date: string
  available_hours: number
  allocated_hours: number
  utilization_pct: number
}

export type TeamSeriesPoint = {
  team_id: number
  team_name: string
  available_hours: number
  allocated_hours: number
  utilization_pct: number
  bench_pct: number
}

export type ProjectSeriesPoint = {
  project_id: number
  project_name: string
  hours: number
}

export type PendingApprovalItem = {
  document_id: string
  team_name: string
  period_start: string
  period_end: string
  status: string
}

export type PendingLeaveItem = {
  document_id: string
  employee_name: string
  start_date: string
  end_date: string
  leave_type: string
}

export type DashboardResult = {
  role: string
  from: string
  to: string
  filters: {
    department_id?: number | null
    team_id?: number | null
    project_id?: number | null
    employee_id?: number | null
  }
  kpis: DashboardKpis
  charts: {
    utilization_by_day: DaySeriesPoint[]
    utilization_by_team: TeamSeriesPoint[]
    allocation_by_project: ProjectSeriesPoint[]
  }
  pending: {
    approvals: PendingApprovalItem[]
    leave: PendingLeaveItem[]
  }
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

async function resolveScopedEmployeeIds(
  strapi: Core.Strapi,
  opts: {
    userId: number
    roleType: string | null
    departmentId?: number
    teamId?: number
    projectId?: number
    employeeId?: number
  },
): Promise<number[] | undefined> {
  const where: Record<string, unknown> = { status: 'active' }

  if (opts.employeeId) {
    where.id = opts.employeeId
  } else if (opts.projectId) {
    const project = await strapi.db.query('api::project.project').findOne({
      where: { id: opts.projectId },
      populate: ['assigned_employees'],
    })
    const assigned = (project?.assigned_employees || []).map((e: { id: number }) => e.id)
    const allocRows = await strapi.db.query('api::allocation.allocation').findMany({
      where: { project: opts.projectId },
      populate: ['employee'],
    })
    const fromAlloc = allocRows
      .map((r: { employee?: { id?: number } }) => r.employee?.id)
      .filter((id): id is number => typeof id === 'number')
    const ids = [...new Set([...assigned, ...fromAlloc])]
    if (!ids.length) return []
    where.id = { $in: ids }
  }

  if (opts.teamId) {
    where.team = opts.teamId
  } else if (opts.departmentId) {
    where.team = { department: opts.departmentId }
  }

  if (opts.roleType === 'employee') {
    where.user = opts.userId
  } else if (opts.roleType === 'team_leader') {
    where.team = opts.teamId
      ? { id: opts.teamId, team_leader: opts.userId }
      : { team_leader: opts.userId }
  } else if (opts.roleType === 'department_manager') {
    if (opts.departmentId) {
      where.team = { department: { id: opts.departmentId, manager: opts.userId } }
    } else if (opts.teamId) {
      where.team = { id: opts.teamId, department: { manager: opts.userId } }
    } else {
      where.team = { department: { manager: opts.userId } }
    }
  }

  const employees = await strapi.db.query('api::employee.employee').findMany({
    where,
    select: ['id'],
  })
  return employees.map((e: { id: number }) => e.id)
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

function aggregateCapacity(
  capacity: CapacityResult,
  projectAllocMap?: Map<string, number>,
): {
  kpis: Pick<
    DashboardKpis,
    'employees' | 'available_hours' | 'allocated_hours' | 'remaining_hours' | 'utilization_pct' | 'bench_pct'
  >
  utilization_by_day: DaySeriesPoint[]
  utilization_by_team: TeamSeriesPoint[]
} {
  const dayTotals = new Map<string, { available: number; allocated: number }>()
  const teamTotals = new Map<
    number,
    { name: string; available: number; allocated: number }
  >()

  for (const emp of capacity.employees) {
    for (const day of emp.days) {
      const allocated =
        projectAllocMap?.get(`${emp.employee_id}:${day.date}`) ?? day.allocated_hours
      const available = day.available_hours
      const remaining = Math.max(0, available - allocated)

      const dt = dayTotals.get(day.date) || { available: 0, allocated: 0 }
      dt.available += available
      dt.allocated += allocated
      dayTotals.set(day.date, dt)

      if (emp.team_id) {
        const tt = teamTotals.get(emp.team_id) || {
          name: emp.team_name || `#${emp.team_id}`,
          available: 0,
          allocated: 0,
        }
        tt.available += available
        tt.allocated += allocated
        teamTotals.set(emp.team_id, tt)
      }

      void remaining
    }
  }

  let totalAvailable = 0
  let totalAllocated = 0

  const utilization_by_day: DaySeriesPoint[] = [...dayTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      totalAvailable += v.available
      totalAllocated += v.allocated
      return {
        date,
        available_hours: Math.round(v.available * 100) / 100,
        allocated_hours: Math.round(v.allocated * 100) / 100,
        utilization_pct: pct(v.allocated, v.available),
      }
    })

  const utilization_by_team: TeamSeriesPoint[] = [...teamTotals.entries()]
    .map(([team_id, v]) => ({
      team_id,
      team_name: v.name,
      available_hours: Math.round(v.available * 100) / 100,
      allocated_hours: Math.round(v.allocated * 100) / 100,
      utilization_pct: pct(v.allocated, v.available),
      bench_pct: pct(Math.max(0, v.available - v.allocated), v.available),
    }))
    .sort((a, b) => b.utilization_pct - a.utilization_pct)

  const remaining = Math.max(0, totalAvailable - totalAllocated)

  return {
    kpis: {
      employees: capacity.employees.length,
      available_hours: Math.round(totalAvailable * 100) / 100,
      allocated_hours: Math.round(totalAllocated * 100) / 100,
      remaining_hours: Math.round(remaining * 100) / 100,
      utilization_pct: pct(totalAllocated, totalAvailable),
      bench_pct: pct(remaining, totalAvailable),
    },
    utilization_by_day,
    utilization_by_team,
  }
}

async function loadAllocationByProject(
  strapi: Core.Strapi,
  employeeIds: number[],
  from: string,
  to: string,
): Promise<ProjectSeriesPoint[]> {
  if (!employeeIds.length) return []

  const rows = await strapi.db.query('api::allocation.allocation').findMany({
    where: {
      employee: { id: { $in: employeeIds } },
      allocation_date: { $gte: from, $lte: to },
    },
    populate: ['project'],
  })

  const map = new Map<number, { name: string; hours: number }>()
  for (const row of rows) {
    const project = row.project as { id?: number; name?: string } | undefined
    if (!project?.id) continue
    const cur = map.get(project.id) || { name: project.name || `#${project.id}`, hours: 0 }
    cur.hours += Number(row.hours || 0)
    map.set(project.id, cur)
  }

  return [...map.entries()]
    .map(([project_id, v]) => ({
      project_id,
      project_name: v.name,
      hours: Math.round(v.hours * 100) / 100,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8)
}

async function countActiveProjects(
  strapi: Core.Strapi,
  employeeIds: number[] | undefined,
): Promise<number> {
  if (employeeIds && !employeeIds.length) return 0

  const where: Record<string, unknown> = {
    status: { $in: ['planned', 'active'] },
  }

  if (employeeIds?.length) {
    where.assigned_employees = { id: { $in: employeeIds } }
  }

  return strapi.db.query('api::project.project').count({ where })
}

async function loadPendingApprovals(
  strapi: Core.Strapi,
  opts: {
    userId: number
    roleType: string | null
    teamId?: number
    departmentId?: number
  },
): Promise<{ items: PendingApprovalItem[]; count: number }> {
  if (opts.roleType === 'employee') {
    return { items: [], count: 0 }
  }

  const where: Record<string, unknown> = {
    status: { $in: ['submitted', 'returned'] },
  }

  if (opts.teamId) {
    where.team = opts.teamId
  } else if (opts.departmentId) {
    where.team = { department: opts.departmentId }
  } else if (opts.roleType === 'team_leader') {
    where.team = { team_leader: opts.userId }
  } else if (opts.roleType === 'department_manager') {
    where.team = { department: { manager: opts.userId } }
  }

  const rows = await strapi.db.query('api::approval.approval').findMany({
    where,
    populate: ['team'],
    orderBy: { submitted_at: 'desc' },
    limit: 5,
  })

  const items: PendingApprovalItem[] = rows.map(
    (r: {
      documentId: string
      period_start: string
      period_end: string
      status: string
      team?: { name?: string }
    }) => ({
      document_id: r.documentId,
      team_name: r.team?.name || '',
      period_start: r.period_start,
      period_end: r.period_end,
      status: r.status,
    }),
  )

  const count = await strapi.db.query('api::approval.approval').count({ where })
  return { items, count }
}

async function loadPendingLeave(
  strapi: Core.Strapi,
  opts: {
    userId: number
    roleType: string | null
    employeeIds?: number[]
  },
): Promise<{ items: PendingLeaveItem[]; count: number }> {
  const where: Record<string, unknown> = { status: 'pending' }

  if (opts.roleType === 'employee') {
    where.employee = { user: opts.userId }
  } else if (opts.employeeIds?.length) {
    where.employee = { id: { $in: opts.employeeIds } }
  } else if (opts.roleType === 'team_leader') {
    where.employee = { team: { team_leader: opts.userId } }
  } else if (opts.roleType === 'department_manager') {
    where.employee = { team: { department: { manager: opts.userId } } }
  }

  const rows = await strapi.db.query('api::leave.leave').findMany({
    where,
    populate: ['employee'],
    orderBy: { start_date: 'asc' },
    limit: 5,
  })

  const items: PendingLeaveItem[] = rows.map(
    (r: {
      documentId: string
      start_date: string
      end_date: string
      leave_type: string
      employee?: { full_name?: string }
    }) => ({
      document_id: r.documentId,
      employee_name: r.employee?.full_name || '',
      start_date: r.start_date,
      end_date: r.end_date,
      leave_type: r.leave_type,
    }),
  )

  const count = await strapi.db.query('api::leave.leave').count({ where })
  return { items, count }
}

export async function computeDashboard(
  strapi: Core.Strapi,
  opts: {
    from: string
    to: string
    userId: number
    roleType: string | null
    departmentId?: number
    teamId?: number
    projectId?: number
    employeeId?: number
  },
): Promise<DashboardResult> {
  const employeeIds = await resolveScopedEmployeeIds(strapi, opts)

  if (employeeIds && employeeIds.length === 0) {
    return {
      role: opts.roleType || 'authenticated',
      from: opts.from,
      to: opts.to,
      filters: {
        department_id: opts.departmentId ?? null,
        team_id: opts.teamId ?? null,
        project_id: opts.projectId ?? null,
        employee_id: opts.employeeId ?? null,
      },
      kpis: {
        employees: 0,
        available_hours: 0,
        allocated_hours: 0,
        remaining_hours: 0,
        utilization_pct: 0,
        bench_pct: 0,
        active_projects: 0,
        pending_approvals: 0,
        pending_leave: 0,
      },
      charts: {
        utilization_by_day: [],
        utilization_by_team: [],
        allocation_by_project: [],
      },
      pending: { approvals: [], leave: [] },
    }
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
    const ids = capacity.employees.map((e) => e.employee_id)
    projectAllocMap = await loadProjectAllocatedHours(
      strapi,
      opts.projectId,
      ids,
      capacity.from,
      capacity.to,
    )
  }

  const aggregated = aggregateCapacity(capacity, projectAllocMap)
  const scopedIds = capacity.employees.map((e) => e.employee_id)

  const [allocation_by_project, active_projects, pendingApprovals, pendingLeave] =
    await Promise.all([
      loadAllocationByProject(strapi, scopedIds, capacity.from, capacity.to),
      countActiveProjects(strapi, scopedIds),
      loadPendingApprovals(strapi, {
        userId: opts.userId,
        roleType: opts.roleType,
        teamId: opts.teamId,
        departmentId: opts.departmentId,
      }),
      loadPendingLeave(strapi, {
        userId: opts.userId,
        roleType: opts.roleType,
        employeeIds: scopedIds,
      }),
    ])

  return {
    role: opts.roleType || 'authenticated',
    from: capacity.from,
    to: capacity.to,
    filters: {
      department_id: opts.departmentId ?? null,
      team_id: opts.teamId ?? null,
      project_id: opts.projectId ?? null,
      employee_id: opts.employeeId ?? null,
    },
    kpis: {
      ...aggregated.kpis,
      active_projects,
      pending_approvals: pendingApprovals.count,
      pending_leave: pendingLeave.count,
    },
    charts: {
      utilization_by_day: aggregated.utilization_by_day,
      utilization_by_team: aggregated.utilization_by_team,
      allocation_by_project,
    },
    pending: {
      approvals: pendingApprovals.items,
      leave: pendingLeave.items,
    },
  }
}
